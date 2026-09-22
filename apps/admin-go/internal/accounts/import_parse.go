package accounts

import (
	"encoding/json"
	"fmt"
	"github.com/codex-switch/admin-go/internal/platform"
	"strings"
)

var nestedAuthKeys = []string{"auth", "auth_json", "authJson", "session", "session_json", "sessionJson"}

const maxImportAccounts = 1000

func parsedObject(value interface{}) object {
	if m, ok := value.(map[string]interface{}); ok {
		return m
	}
	if text, ok := value.(string); ok {
		result := object{}
		if json.Unmarshal([]byte(text), &result) == nil {
			return result
		}
	}
	return nil
}

func pathValue(value object, path string) interface{} {
	var current interface{} = value
	for _, key := range strings.Split(path, ".") {
		current = obj(current)[key]
	}
	return current
}
func firstPath(value object, paths ...string) string {
	for _, path := range paths {
		if s := strings.TrimSpace(str(pathValue(value, path))); s != "" {
			return s
		}
	}
	return ""
}
func tokenPaths(snake, camel string) []string {
	result := []string{}
	for _, prefix := range []string{"", "tokens.", "token.", "credentials."} {
		result = append(result, prefix+snake, prefix+camel)
	}
	return result
}

func parsePersonal(content string) ([]interface{}, error) {
	content = strings.TrimSpace(strings.TrimPrefix(content, "\ufeff"))
	if content == "" {
		return nil, platform.NewError(400, "导入内容为空")
	}
	var value interface{}
	if json.Unmarshal([]byte(content), &value) == nil {
		return unpackPersonal(value)
	}
	lines := strings.Split(content, "\n")
	result := []interface{}{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if json.Unmarshal([]byte(line), &value) != nil {
			return nil, platform.NewError(400, "导入内容不是有效的 JSON")
		}
		rows, err := unpackPersonal(value)
		if err != nil {
			return nil, err
		}
		result = append(result, rows...)
	}
	if len(result) > maxImportAccounts {
		return nil, platform.NewError(400, "导入内容不是有效的 JSON")
	}
	return result, nil
}

func unpackPersonal(value interface{}) ([]interface{}, error) {
	if rows, ok := value.([]interface{}); ok {
		return rows, nil
	}
	m, ok := value.(map[string]interface{})
	if !ok {
		return nil, platform.NewError(400, "导入内容必须是 JSON 对象或数组")
	}
	if rows, ok := m["accounts"].([]interface{}); ok {
		return rows, nil
	}
	return []interface{}{m}, nil
}

func findAuth(value interface{}, depth int) (object, error) {
	m := parsedObject(value)
	if m == nil || depth > 8 {
		return nil, platform.NewError(400, "账号格式无效")
	}
	for _, key := range nestedAuthKeys {
		if child := parsedObject(m[key]); child != nil {
			return findAuth(child, depth+1)
		}
	}
	return m, nil
}

func normalizePersonalAuth(value interface{}) (object, error) {
	source, err := findAuth(value, 0)
	if err != nil {
		return nil, err
	}
	credentials := obj(source["credentials"])
	mode := strings.ToLower(first(credentials["auth_mode"], source["auth_mode"]))
	if mode == "agentidentity" || source["agent_identity"] != nil {
		identitySource := obj(source["agent_identity"])
		if mode == "agentidentity" && len(credentials) > 0 {
			identitySource = credentials
		}
		if len(identitySource) > 0 {
			identity := object{}
			for _, key := range []string{
				"agent_runtime_id", "agent_private_key", "account_id", "chatgpt_account_id",
				"chatgpt_user_id", "task_id", "email", "plan_type",
			} {
				if value := firstPath(identitySource, key); value != "" {
					identity[key] = value
				}
			}
			identity["chatgpt_account_is_fedramp"] = identitySource["chatgpt_account_is_fedramp"] == true
			return object{"auth_mode": "agentIdentity", "agent_identity": identity}, nil
		}
	}
	tokens := extractTokens(source)
	if first(tokens["access_token"], tokens["refresh_token"], tokens["session_token"]) == "" {
		return nil, platform.NewError(400, "没有找到 Codex 登录凭据")
	}
	for _, key := range []string{"account_id", "chatgpt_user_id", "email", "plan_type", "organization_id", "expires_at"} {
		paths := []string{key, "credentials." + key}
		if key == "account_id" {
			paths = []string{"account_id", "chatgpt_account_id", "credentials.chatgpt_account_id"}
		}
		if key == "chatgpt_user_id" {
			paths = []string{"chatgpt_user_id", "user_id", "credentials.chatgpt_user_id"}
		}
		if value := firstPath(source, paths...); value != "" {
			tokens[key] = value
		}
	}
	return object{"auth_mode": "chatgpt", "OPENAI_API_KEY": nil, "tokens": tokens, "last_refresh": iso(now())}, nil
}

func extractTokens(source object) object {
	result := object{}
	for _, pair := range [][2]string{
		{"access_token", "accessToken"}, {"refresh_token", "refreshToken"},
		{"id_token", "idToken"}, {"session_token", "sessionToken"},
	} {
		if value := firstPath(source, tokenPaths(pair[0], pair[1])...); value != "" {
			result[pair[0]] = value
		}
	}
	return result
}

func collectCompatible(value interface{}, depth int) []interface{} {
	if depth > 12 {
		return nil
	}
	if rows, ok := value.([]interface{}); ok {
		result := []interface{}{}
		for _, row := range rows {
			result = append(result, collectCompatible(row, depth+1)...)
		}
		return result
	}
	m, ok := value.(map[string]interface{})
	if !ok {
		return nil
	}
	tokens := extractTokens(m)
	if first(tokens["access_token"], tokens["refresh_token"], tokens["id_token"]) != "" {
		return []interface{}{m}
	}
	result := []interface{}{}
	for key, nested := range m {
		if key == "accessToken" || key == "access_token" || key == "sessionToken" {
			continue
		}
		if text, ok := nested.(string); ok {
			for _, authKey := range nestedAuthKeys {
				if key == authKey {
					var decoded interface{}
					if json.Unmarshal([]byte(text), &decoded) == nil {
						result = append(result, collectCompatible(decoded, depth+1)...)
					}
					break
				}
			}
			continue
		}
		result = append(result, collectCompatible(nested, depth+1)...)
	}
	return result
}

func parseCompatible(content string) ([]interface{}, error) {
	content = strings.TrimSpace(strings.TrimPrefix(content, "\ufeff"))
	if content == "" {
		return nil, platform.NewError(400, "Import file is empty")
	}
	var value interface{}
	err := json.Unmarshal([]byte(content), &value)
	if err == nil {
		return unpackCompatibleJSON(content)
	}
	result := []interface{}{}
	for _, slice := range jsonSlices(content) {
		if json.Unmarshal([]byte(slice), &value) == nil {
			rows, e := unpackCompatibleJSON(slice)
			if e == nil {
				result = append(result, rows...)
			}
		}
	}
	if len(result) > 0 {
		return result, nil
	}
	lines := strings.Split(content, "\n")
	if len(lines) <= 1 {
		return nil, platform.NewError(400, "Invalid JSON: "+err.Error())
	}
	for index, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if e := json.Unmarshal([]byte(line), &value); e != nil {
			return nil, platform.NewError(400, fmt.Sprintf("Line %d is not valid JSON: %s", index+1, e))
		}
		if _, ok := value.(map[string]interface{}); !ok {
			return nil, platform.NewError(400, fmt.Sprintf("Line %d must contain a JSON object", index+1))
		}
		result = append(result, value)
	}
	if len(result) > maxImportAccounts {
		return nil, platform.NewError(400, "A single import supports at most 1000 accounts")
	}
	return result, nil
}

func unpackCompatible(value interface{}) ([]interface{}, error) {
	_, objectOK := value.(map[string]interface{})
	_, arrayOK := value.([]interface{})
	if !objectOK && !arrayOK {
		return nil, platform.NewError(400, "Import file must contain a JSON object or array at the top level")
	}
	rows := collectCompatible(value, 0)
	if len(rows) == 0 {
		return nil, platform.NewError(400, "Import file does not contain any accounts")
	}
	if len(rows) > maxImportAccounts {
		return nil, platform.NewError(400, "A single import supports at most 1000 accounts")
	}
	return rows, nil
}

func jsonSlices(content string) []string {
	result := []string{}
	stack := []byte{}
	start := -1
	quoted, escaped := false, false
	for i := 0; i < len(content); i++ {
		c := content[i]
		if quoted {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				quoted = false
			}
			continue
		}
		if c == '"' {
			quoted = len(stack) > 0
			continue
		}
		if c == '{' || c == '[' {
			if len(stack) == 0 {
				start = i
			}
			stack = append(stack, c)
			continue
		}
		if c != '}' && c != ']' {
			continue
		}
		if len(stack) == 0 {
			continue
		}
		open := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if (c == '}' && open != '{') || (c == ']' && open != '[') {
			stack = nil
			start = -1
		} else if len(stack) == 0 && start >= 0 {
			result = append(result, content[start:i+1])
			start = -1
		}
	}
	return result
}
