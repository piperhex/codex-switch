package accounts

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
)

// Walk raw JSON in document order: account imports expose that order in their result arrays.
func collectCompatibleJSON(raw json.RawMessage, depth int) []interface{} {
	if depth > 12 {
		return nil
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '[' {
		var rows []json.RawMessage
		if json.Unmarshal(raw, &rows) != nil {
			return nil
		}
		result := []interface{}{}
		for _, row := range rows {
			result = append(result, collectCompatibleJSON(row, depth+1)...)
		}
		return result
	}
	if raw[0] != '{' {
		return nil
	}
	source := object{}
	if json.Unmarshal(raw, &source) != nil {
		return nil
	}
	tokens := extractTokens(source)
	if first(tokens["access_token"], tokens["refresh_token"], tokens["id_token"]) != "" {
		return []interface{}{source}
	}
	return collectCompatibleProperties(raw, depth)
}

func collectCompatibleProperties(raw json.RawMessage, depth int) []interface{} {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if _, err := decoder.Token(); err != nil {
		return nil
	}
	result := []interface{}{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return result
		}
		key := str(token)
		var nested json.RawMessage
		if decoder.Decode(&nested) != nil {
			return result
		}
		if key == "accessToken" || key == "access_token" || key == "sessionToken" {
			continue
		}
		var text string
		if json.Unmarshal(nested, &text) == nil {
			if isAuthWrapper(key) {
				result = append(result, collectCompatibleJSON(json.RawMessage(text), depth+1)...)
			}
			continue
		}
		result = append(result, collectCompatibleJSON(nested, depth+1)...)
	}
	return result
}

func isAuthWrapper(key string) bool {
	for _, candidate := range nestedAuthKeys {
		if key == candidate {
			return true
		}
	}
	return false
}

func unpackCompatibleJSON(content string) ([]interface{}, error) {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
		return nil, platform.NewError(400, "Import file must contain a JSON object or array at the top level")
	}
	rows := collectCompatibleJSON(json.RawMessage(trimmed), 0)
	if len(rows) == 0 {
		return nil, platform.NewError(400, "Import file does not contain any accounts")
	}
	if len(rows) > maxImportAccounts {
		return nil, platform.NewError(400, "A single import supports at most 1000 accounts")
	}
	return rows, nil
}
