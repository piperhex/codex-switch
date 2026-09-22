package accounts

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"unicode/utf16"

	"github.com/codex-switch/admin-go/internal/platform"
)

func normalizeAuth(auth object) (object, error) {
	if accounts, ok := auth["accounts"].([]interface{}); ok {
		if len(accounts) != 1 {
			return nil, platform.NewError(400, "Use compatible JSON import when the file contains multiple accounts")
		}
		nested, ok := accounts[0].(map[string]interface{})
		if !ok {
			return nil, platform.NewError(400, "Use compatible JSON import when the file contains multiple accounts")
		}
		return normalizeAuth(nested)
	}
	if auth["platform"] != "openai" || auth["type"] != "oauth" {
		return auth, nil
	}
	credentials := obj(auth["credentials"])
	if strings.EqualFold(str(credentials["auth_mode"]), "agentidentity") {
		identity := object{}
		for _, key := range []string{
			"agent_runtime_id", "agent_private_key", "account_id", "chatgpt_user_id", "task_id", "email", "plan_type",
		} {
			if str(credentials[key]) != "" {
				identity[key] = credentials[key]
			}
		}
		identity["chatgpt_account_is_fedramp"] = credentials["chatgpt_account_is_fedramp"] == true
		return object{"auth_mode": "agentIdentity", "agent_identity": identity}, nil
	}
	if str(credentials["access_token"]) == "" {
		return auth, nil
	}
	tokens := object{
		"access_token":  credentials["access_token"],
		"id_token":      str(credentials["id_token"]),
		"refresh_token": str(credentials["refresh_token"]),
	}
	for _, key := range []string{
		"chatgpt_account_id", "chatgpt_user_id", "email", "plan_type", "organization_id", "expires_at",
	} {
		if str(credentials[key]) != "" {
			target := key
			if key == "chatgpt_account_id" {
				target = "account_id"
			}
			tokens[target] = credentials[key]
		}
	}
	return object{"auth_mode": "chatgpt", "OPENAI_API_KEY": nil, "tokens": tokens, "last_refresh": iso(now())}, nil
}

func decodeClaims(token string) object {
	claims, _ := parseClaims(token)
	return obj(claims)
}

func parseClaims(token string) (object, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return nil, false
	}
	result := object{}
	if json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, false
	}
	return result, true
}

func authIdentity(auth object) (object, error) {
	if auth == nil {
		return nil, platform.NewError(400, "auth.json must be a JSON object")
	}
	if strings.EqualFold(str(auth["auth_mode"]), "agentidentity") || auth["agent_identity"] != nil {
		return agentIdentity(auth)
	}
	tokens := obj(auth["tokens"])
	access := str(tokens["access_token"])
	if access == "" {
		return nil, platform.NewError(400, "auth.json is missing tokens.access_token")
	}
	claims := decodeClaims(first(tokens["id_token"], access))
	nested := obj(claims["https://api.openai.com/auth"])
	profile := obj(claims["https://api.openai.com/profile"])
	email := first(tokens["email"], claims["email"], profile["email"], "Unknown account")
	plan := first(tokens["plan_type"], nested["chatgpt_plan_type"], "ChatGPT")
	codexID := first(tokens["account_id"], tokens["chatgpt_account_id"], nested["chatgpt_account_id"])
	identity := first(
		tokens["chatgpt_user_id"],
		tokens["user_id"],
		nested["chatgpt_user_id"],
		nested["user_id"],
		claims["sub"],
		tokens["email"],
	)
	if identity == "" {
		return nil, platform.NewError(400, "auth.json contains an invalid ChatGPT token")
	}
	return identityResult(identity, email, plan, codexID)
}

func agentIdentity(auth object) (object, error) {
	identity := obj(auth["agent_identity"])
	if len(identity) == 0 {
		return nil, platform.NewError(400, "auth.json is missing agent_identity")
	}
	codexID := first(identity["account_id"], identity["chatgpt_account_id"])
	user := str(identity["chatgpt_user_id"])
	key := str(identity["agent_private_key"])
	if str(identity["agent_runtime_id"]) == "" || key == "" || codexID == "" || user == "" {
		return nil, platform.NewError(400, "auth.json contains an incomplete Agent Identity credential")
	}
	if !validPrivateKey(key) {
		return nil, platform.NewError(400, "auth.json contains an invalid Agent Identity private key")
	}
	return identityResult(
		user,
		first(identity["email"], "Unknown account"),
		first(identity["plan_type"], "ChatGPT"),
		codexID,
	)
}

func validPrivateKey(key string) bool {
	normalized := strings.TrimRight(strings.Join(strings.Fields(key), ""), "=")
	raw, err := base64.RawStdEncoding.DecodeString(normalized)
	return err == nil && len(raw) >= 32 && base64.RawStdEncoding.EncodeToString(raw) == normalized
}

func identityResult(identity, email, plan, codexID string) (object, error) {
	if len(utf16.Encode([]rune(email))) > 240 || len(utf16.Encode([]rune(plan))) > 80 ||
		len(utf16.Encode([]rune(codexID))) > 160 {
		return nil, platform.NewError(400, "Official account identity exceeds the supported length")
	}
	accountIdentity := codexID
	var accountID interface{} = codexID
	if codexID == "" {
		accountIdentity = "personal"
		accountID = nil
	}
	hash := sha256.Sum256([]byte(identity + "\x00" + accountIdentity))
	return object{
		"syncAccountId":  hex.EncodeToString(hash[:12]),
		"email":          email,
		"plan":           plan,
		"codexAccountId": accountID,
	}, nil
}

func (s *service) personalFromAuth(owner string, raw object) (object, error) {
	auth, err := normalizeAuth(raw)
	if err != nil {
		return nil, err
	}
	identity, err := authIdentity(auth)
	if err != nil {
		return nil, err
	}
	current, err := s.effectiveByID(owner, str(identity["syncAccountId"]))
	if err != nil {
		public, ok := err.(*platform.HTTPError)
		if !ok || public.Status != 404 {
			return nil, err
		}
		current = object{}
	}
	in := personalAuthInput(current, identity, auth)
	if _, err = s.upsertAccounts(writeOptions{Owner: owner, RejectMetadata: true}, []object{in}); err != nil {
		return nil, err
	}
	result, err := s.effectiveByID(owner, str(in["id"]))
	if err != nil {
		return nil, err
	}
	return mobile(result), nil
}

func personalAuthInput(current, identity, auth object) object {
	modified := iso(now())
	v := versions(obj(current["fieldModifiedAt"]), valueOr(current["lastModifiedAt"], modified), accountFields)
	v["auth"] = modified
	in := object{
		"id":        identity["syncAccountId"],
		"email":     identity["email"],
		"plan":      identity["plan"],
		"accountId": identity["codexAccountId"],
		"note": valueOr(
			current["note"],
			"",
		),
		"expiresAt": valueOr(current["expiresAt"], ""),
		"active":    valueOr(current["active"], false),
		"autoSwitchPriority": valueOr(
			current["autoSwitchPriority"],
			0,
		),
		"autoSwitchThreshold": valueOr(current["autoSwitchThreshold"], 0),
		"usage":               valueOr(current["usage"], object{}),
		"auth":                auth,
		"fieldModifiedAt":     v,
		"lastModifiedAt":      modified,
	}
	if has(current, "privateDetails") {
		in["privateDetails"] = current["privateDetails"]
	}
	return in
}
