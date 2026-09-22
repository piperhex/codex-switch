package accounts

import (
	"encoding/base64"
	"encoding/json"
	"reflect"
	"testing"
)

func tokenFixture(claims object) string {
	raw, _ := json.Marshal(claims)
	return "eyJhbGciOiJub25lIn0." + base64.RawURLEncoding.EncodeToString(raw) + ".fixture"
}

func TestAuthIdentityStableAcrossJWTAndOpaqueExports(t *testing.T) {
	claims := object{
		"sub":                         "user-id",
		"email":                       "user@example.test",
		"https://api.openai.com/auth": object{"chatgpt_account_id": "workspace-id", "chatgpt_plan_type": "plus"},
	}
	jwt := object{"tokens": object{"access_token": tokenFixture(claims)}}
	opaque := object{
		"tokens": object{
			"access_token":    "opaque",
			"email":           "user@example.test",
			"chatgpt_user_id": "user-id",
			"account_id":      "workspace-id",
			"plan_type":       "plus",
		},
	}
	a, err := authIdentity(jwt)
	if err != nil {
		t.Fatal(err)
	}
	b, err := authIdentity(opaque)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("identity drift: %#v vs %#v", a, b)
	}
}

func TestAgentIdentityRequiresValidPrivateKey(t *testing.T) {
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	auth := object{
		"auth_mode": "agentIdentity",
		"agent_identity": object{
			"agent_runtime_id":  "runtime",
			"agent_private_key": key,
			"account_id":        "account",
			"chatgpt_user_id":   "user",
		},
	}
	result, err := authIdentity(auth)
	if err != nil || len(str(result["syncAccountId"])) != 24 {
		t.Fatalf("valid Agent Identity rejected: %v", err)
	}
	obj(auth["agent_identity"])["agent_private_key"] = "bad"
	if _, err = authIdentity(auth); err == nil {
		t.Fatal("invalid private key accepted")
	}
}

func TestCompatibleImportsDiscoverWrappersAndPreserveIdentity(t *testing.T) {
	content := `{"data":{"accounts":[
		{"accessToken":"opaque","user":{"id":"user","email":"mail@example.test"},
		"account":{"id":"workspace","planType":"pro"}},
		{"session_json":"{\"access_token\":\"second\",\"email\":\"other@example.test\"}"}]}}`
	values, err := parseCompatible(content)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 {
		t.Fatalf("missing nested accounts: %#v", values)
	}
	auth, err := normalizeCompatibleAuth(values[0])
	if err != nil {
		t.Fatal(err)
	}
	identity, err := authIdentity(auth)
	if err != nil {
		t.Fatal(err)
	}
	if identity["email"] != "mail@example.test" || identity["codexAccountId"] != "workspace" ||
		identity["plan"] != "pro" {
		t.Fatalf("lost explicit identity: %#v", identity)
	}
}

func TestPersonalImportAliasesAndBOM(t *testing.T) {
	values, err := parsePersonal(
		"\ufeff{\"sessionJson\":\"{\\\"accessToken\\\":\\\"opaque\\\",\\\"refreshToken\\\":\\\"refresh\\\"}\"}",
	)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := normalizePersonalAuth(values[0])
	if err != nil {
		t.Fatal(err)
	}
	tokens := obj(auth["tokens"])
	if tokens["access_token"] != "opaque" || tokens["refresh_token"] != "refresh" {
		t.Fatalf("alias normalization failed: %#v", auth)
	}
}

func TestUsageNormalizationClampsAndFindsEarliestPromoExpiry(t *testing.T) {
	window := obj(
		usageWindow(
			object{"used_percent": float64(135), "limit_window_seconds": float64(300), "reset_at": float64(123)},
		),
	)
	if window["usedPercent"] != float64(100) || window["remainingPercent"] != float64(0) ||
		window["windowMinutes"] != float64(5) {
		t.Fatalf("unexpected window: %#v", window)
	}
	value := promoExpiration(object{"nested": []interface{}{object{"expires_at": testNew}, object{"endDate": testOld}}})
	if value != testOld {
		t.Fatalf("wrong earliest expiry: %v", value)
	}
}

func TestOutboundProxyRejectsUnsupportedSchemes(t *testing.T) {
	for _, value := range []string{"bad proxy", "socks5://127.0.0.1:1080", "https://"} {
		if validateOutboundProxy(value) == nil {
			t.Fatalf("accepted invalid proxy %q", value)
		}
	}
	for _, value := range []string{"", "http://127.0.0.1:7890", " https://user:password@proxy.example.test "} {
		if err := validateOutboundProxy(value); err != nil {
			t.Fatalf("valid proxy rejected: %v", err)
		}
	}
}

func TestCompatibleImportPreservesDecodableEmptyJWT(t *testing.T) {
	token := tokenFixture(object{})
	auth, err := normalizeCompatibleAuth(
		object{"access_token": "opaque", "id_token": token, "email": "user@example.test"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if obj(auth["tokens"])["id_token"] != token {
		t.Fatal("a decodable empty JWT must not be treated as malformed")
	}
}
