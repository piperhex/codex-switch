package accounts

import (
	"encoding/json"
	"github.com/codex-switch/admin-go/internal/platform"
	"strings"
)

var compatibleIdentityPaths = map[string][]string{
	"account_id": {
		"account.id",
		"account_id",
		"chatgptAccountId",
		"chatgpt_account_id",
		"tokens.accountId",
		"tokens.account_id",
		"tokens.chatgptAccountId",
		"tokens.chatgpt_account_id",
		"token.accountId",
		"token.account_id",
		"token.chatgptAccountId",
		"token.chatgpt_account_id",
		"credentials.chatgpt_account_id",
		"providerSpecificData.chatgptAccountId",
		"providerSpecificData.chatgpt_account_id",
		"meta.chatgptAccountId",
		"meta.chatgpt_account_id",
	},
	"chatgpt_user_id": {
		"user.id",
		"user_id",
		"chatgptUserId",
		"chatgpt_user_id",
		"tokens.userId",
		"tokens.user_id",
		"tokens.chatgptUserId",
		"tokens.chatgpt_user_id",
		"token.userId",
		"token.user_id",
		"token.chatgptUserId",
		"token.chatgpt_user_id",
		"credentials.chatgpt_user_id",
		"providerSpecificData.chatgptUserId",
		"providerSpecificData.chatgpt_user_id",
	},
	"email": {
		"user.email",
		"email",
		"label",
		"meta.label",
		"credentials.email",
		"providerSpecificData.email",
	},
	"plan_type": {
		"account.planType",
		"account.plan_type",
		"planType",
		"plan_type",
		"credentials.plan_type",
		"providerSpecificData.chatgptPlanType",
		"providerSpecificData.chatgpt_plan_type",
	},
	"organization_id": {
		"organizationId",
		"organization_id",
		"meta.organizationId",
		"meta.organization_id",
		"credentials.organization_id",
		"providerSpecificData.organizationId",
		"providerSpecificData.organization_id",
	},
	"expires_at": {"expires", "expiresAt", "expires_at", "expired", "credentials.expires_at"},
	"workspace_id": {
		"account.workspaceId",
		"account.workspace_id",
		"workspaceId",
		"workspace_id",
		"meta.workspaceId",
		"meta.workspace_id",
		"credentials.workspace_id",
		"providerSpecificData.workspaceId",
		"providerSpecificData.workspace_id",
	},
}

func normalizeCompatibleAuth(value interface{}) (object, error) {
	accounts := collectCompatible(value, 0)
	if len(accounts) == 0 {
		return nil, platform.NewError(
			400,
			"No Codex token found; supported fields include access_token/accessToken, "+
				"tokens, credentials, session/session_json, and refresh_token",
		)
	}
	source := obj(accounts[0])
	tokens := extractTokens(source)
	if len(tokens) == 0 {
		nested, err := findAuth(source, 0)
		if err != nil {
			return nil, err
		}
		tokens = extractTokens(nested)
	}
	if _, ok := parseClaims(str(tokens["id_token"])); !ok {
		delete(tokens, "id_token")
	}
	if tokens["refresh_token"] == "__missing_refresh_token__" {
		delete(tokens, "refresh_token")
	}
	for key, paths := range compatibleIdentityPaths {
		if value := firstPath(source, paths...); value != "" {
			tokens[key] = value
		}
	}
	if source["provider"] == "codex" && tokens["account_id"] == nil && str(source["id"]) != "" {
		tokens["account_id"] = source["id"]
	}
	enrichTokens(tokens)
	return object{"tokens": tokens}, nil
}

func enrichTokens(tokens object) {
	claims := decodeClaims(first(tokens["id_token"], tokens["access_token"]))
	auth := obj(claims["https://api.openai.com/auth"])
	profile := obj(claims["https://api.openai.com/profile"])
	organization := ""
	for _, row := range arr(auth["organizations"]) {
		if id := firstPath(obj(row), "id"); id != "" {
			organization = id
			break
		}
	}
	values := object{
		"account_id":      firstPath(auth, "chatgpt_account_id"),
		"chatgpt_user_id": first(firstPath(auth, "chatgpt_user_id", "user_id"), firstPath(claims, "sub")),
		"email":           first(firstPath(claims, "email"), firstPath(profile, "email")),
		"plan_type":       firstPath(auth, "chatgpt_plan_type"),
		"organization_id": first(firstPath(auth, "organization_id"), organization),
		"workspace_id":    firstPath(claims, "workspace_id"),
	}
	for key, value := range values {
		if str(value) != "" && str(tokens[key]) == "" {
			tokens[key] = value
		}
	}
}

func parseSub2api(content string) ([]interface{}, error) {
	content = strings.TrimSpace(strings.TrimPrefix(content, "\ufeff"))
	if content == "" {
		return nil, platform.NewError(400, "Import file is empty")
	}
	var value interface{}
	if err := json.Unmarshal([]byte(content), &value); err != nil {
		return nil, platform.NewError(400, "Invalid sub2api JSON: "+err.Error())
	}
	source, ok := value.(map[string]interface{})
	if !ok {
		return nil, platform.NewError(400, "sub2api export must contain a JSON object at the top level")
	}
	if has(source, "type") && source["type"] != "sub2api-data" {
		return nil, platform.NewError(400, "The selected file is not a sub2api account export")
	}
	if has(source, "version") && source["version"] != float64(1) {
		return nil, platform.NewError(400, "Only version 1 sub2api exports are supported")
	}
	values := arr(source["accounts"])
	if len(values) == 0 {
		return nil, platform.NewError(400, "The sub2api export does not contain any accounts")
	}
	if len(values) > maxImportAccounts {
		return nil, platform.NewError(400, "A single import supports at most 1000 accounts")
	}
	return values, nil
}

func normalizeSub2api(value interface{}) (object, error) {
	m, ok := value.(map[string]interface{})
	if !ok {
		return nil, platform.NewError(400, "sub2api account must be a JSON object")
	}
	if m["platform"] != "openai" || m["type"] != "oauth" {
		return nil, platform.NewError(400, "Only platform=openai and type=oauth accounts are supported")
	}
	credentials, ok := m["credentials"].(map[string]interface{})
	if !ok {
		return nil, platform.NewError(400, "sub2api account is missing credentials")
	}
	if strings.EqualFold(firstPath(credentials, "auth_mode"), "agentidentity") {
		for _, key := range []string{"agent_runtime_id", "agent_private_key", "account_id", "chatgpt_user_id"} {
			if firstPath(credentials, key) == "" {
				return nil, platform.NewError(400, "sub2api credentials is missing "+key)
			}
		}
		if !validPrivateKey(str(credentials["agent_private_key"])) {
			return nil, platform.NewError(400, "sub2api agent_private_key is not valid Base64")
		}
	} else if firstPath(credentials, "access_token") == "" {
		return nil, platform.NewError(400, "sub2api credentials is missing access_token")
	}
	clean := copyObject(m)
	trimmed := copyObject(credentials)
	for key, value := range trimmed {
		if _, ok := value.(string); ok {
			trimmed[key] = strings.TrimSpace(str(value))
		}
	}
	clean["credentials"] = trimmed
	return normalizeAuth(clean)
}
