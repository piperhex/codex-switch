package identity

import (
	"encoding/base64"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/golang-jwt/jwt/v5"
)

func fixtureService() *service {
	return &service{&platform.Dependencies{Config: platform.Config{"KONG_JWT_SECRET": "fixture-secret"}}}
}
func TestRefreshRecoveryReadsLegacyNodeCiphertext(t *testing.T) {
	const legacy = "AAECAwQFBgcICQoLHiacbPalgBL8GjQDv3RPN6YO3+i4MNvJm3WwRfeJlHom"
	value, err := openRecovery("legacy-refresh-token", legacy)
	if err != nil || value != "replacement-token" {
		t.Fatalf("legacy ciphertext failed: %q %v", value, err)
	}
	if _, err = openRecovery("other-token", legacy); err == nil {
		t.Fatal("recovery accepted wrong key")
	}
	encoded, err := sealRecovery("previous-token", "successor-token")
	if err != nil {
		t.Fatal(err)
	}
	value, err = openRecovery("previous-token", encoded)
	if err != nil || value != "successor-token" {
		t.Fatal("roundtrip failed", err)
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if _, err = openRecovery("previous-token", base64.StdEncoding.EncodeToString(data)); err == nil {
		t.Fatal("tampering accepted")
	}
}
func TestMailPasswordReadsLegacyNodeCiphertext(t *testing.T) {
	s := fixtureService()
	const legacy = "v1:AAECAwQFBgcICQoL:akaaFpvPxkHZonPsvLLmQg:5fgWrap1Pm1UVIfiqQ"
	value, err := s.decryptMailPassword(legacy)
	if err != nil || value != "smtp-password" {
		t.Fatalf("legacy password failed: %q %v", value, err)
	}
	encoded, err := s.encryptMailPassword("SMTP 密码")
	if err != nil {
		t.Fatal(err)
	}
	value, err = s.decryptMailPassword(encoded)
	if err != nil || value != "SMTP 密码" {
		t.Fatal("roundtrip failed", err)
	}
	s.deps.Config["KONG_JWT_SECRET"] = "different-secret"
	if _, err = s.decryptMailPassword(legacy); err == nil {
		t.Fatal("wrong key accepted")
	}
}
func TestPermissionDependenciesAndGrantBoundaries(t *testing.T) {
	got := expandPermissions([]string{"admin.email-templates.manage"})
	expected := []string{
		"admin.email-templates.manage",
		"admin.email-templates.read",
		"admin.mail-services.manage",
		"admin.mail-services.read",
	}
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expanded permissions: %v", got)
	}
	actor := &platform.Principal{Role: "custom", Permissions: []string{"self.accounts.read"}}
	if err := canGrant(actor, []string{"admin.users.manage"}); err == nil {
		t.Fatal("privilege escalation accepted")
	}
	if err := canGrant(actor, []string{"self.accounts.read"}); err != nil {
		t.Fatal(err)
	}
}
func TestSignedInvitationRoundTripAndTampering(t *testing.T) {
	s := fixtureService()
	id := "00000000-0000-4000-8000-000000000001"
	token := s.invitationToken(id)
	if s.signedInvitationID(token) != id {
		t.Fatal("valid invitation failed")
	}
	if s.signedInvitationID(token+"x") != "" {
		t.Fatal("tampered invitation accepted")
	}
	if s.signedInvitationID("old-random-token") != "" {
		t.Fatal("legacy token was treated as signed")
	}
}
func TestJWTOnlyAcceptsSymmetricSignedUnexpiredTokens(t *testing.T) {
	claims := jwt.MapClaims{"sub": "fixture", "exp": time.Now().Add(time.Minute).Unix()}
	encoded, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parseToken(encoded, "secret"); err != nil {
		t.Fatal(err)
	}
	if _, err = parseToken(encoded, "different"); err == nil {
		t.Fatal("wrong signing key accepted")
	}
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"exp": time.Now().Add(-time.Minute).Unix()}).
		SignedString([]byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parseToken(expired, "secret"); err == nil {
		t.Fatal("expired token accepted")
	}
}
func TestTemplateRenderingAndVerificationContent(t *testing.T) {
	definition, err := findTemplate(officialAccountBoundCode)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateTemplateVariables(definition, "{{ unsupported }}"); err == nil {
		t.Fatal("unknown variable accepted")
	}
	rendered := renderTemplate("{{userEmail}} / {{ missing }}", map[string]string{"userEmail": "a@example.com"})
	if rendered != "a@example.com / {{ missing }}" {
		t.Fatal(rendered)
	}
	if !strings.Contains(templateHTML("<script>'&\n"), "&lt;script&gt;&#039;&amp;<br>") {
		t.Fatal("HTML was not escaped")
	}
	message := verificationMessage("012345", "registration", time.Date(2026, 1, 2, 3, 4, 0, 0, time.UTC))
	if message.Subject != "012345 是你的 Codex Switch 注册验证码" {
		t.Fatal(message.Subject)
	}
	if !strings.Contains(message.HTML, "02 Jan 2026, 03:04 UTC") || !strings.Contains(message.HTML, "012345") {
		t.Fatal("verification HTML lost dynamic values")
	}
}
func TestPasswordCompatibilityWithBcryptJSTruncation(t *testing.T) {
	password := strings.Repeat("a", 72)
	encoded, err := passwordHash(password + "suffix")
	if err != nil {
		t.Fatal(err)
	}
	if !passwordMatches(encoded, password+"different-suffix") {
		t.Fatal("bcryptjs long-password behavior differs")
	}
	if passwordMatches(encoded, "incorrect") {
		t.Fatal("wrong password accepted")
	}
}

func TestJWTDurationUsesLegacyMillisecondStringSemantics(t *testing.T) {
	for input, expected := range map[string]time.Duration{"120": 120 * time.Millisecond, "2 days": 48 * time.Hour,
		"1.5 hours": 90 * time.Minute, "15m": 15 * time.Minute, "2 WEEKS": 14 * 24 * time.Hour} {
		actual, err := accessLifetime(input)
		if err != nil || actual != expected {
			t.Fatalf("%q: %v %v", input, actual, err)
		}
	}
	if _, err := accessLifetime("arbitrary"); err == nil {
		t.Fatal("invalid lifetime accepted")
	}
}
