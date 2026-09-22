package content

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"github.com/gin-gonic/gin"
	"strings"
	"testing"
	"time"
)

func zipFixture(t *testing.T, names ...string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range names {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte("example")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
func TestSkillArchiveValidation(t *testing.T) {
	for _, test := range []struct {
		name      string
		files     []string
		errorText string
	}{
		{"root", []string{"SKILL.md", "assets/example.txt"}, ""},
		{"nested", []string{"example/skill.md"}, ""},
		{"missing", []string{"README.md"}, "exactly one SKILL.md"},
		{"duplicate", []string{"SKILL.md", "nested/SKILL.md"}, "exactly one SKILL.md"},
		{"traversal", []string{"../SKILL.md"}, "unsafe path"},
		{"absolute", []string{"/SKILL.md"}, "unsafe path"},
		{"windows", []string{`C:\SKILL.md`}, "unsafe path"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateSkillArchive(zipFixture(t, test.files...))
			if test.errorText == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.errorText) {
				t.Fatalf("expected %q, got %v", test.errorText, err)
			}
		})
	}
}
func TestSkillArchiveRejectsSymlinksAndExpansion(t *testing.T) {
	original := zipFixture(t, "SKILL.md")
	central := bytes.Index(original, []byte{0x50, 0x4b, 0x01, 0x02})
	if central < 0 {
		t.Fatal("missing central directory")
	}
	symlink := append([]byte{}, original...)
	binary.LittleEndian.PutUint32(symlink[central+38:], 0120777<<16)
	if err := ValidateSkillArchive(symlink); err == nil || !strings.Contains(err.Error(), "symbolic links") {
		t.Fatalf("symlink: %v", err)
	}
	expanded := append([]byte{}, original...)
	binary.LittleEndian.PutUint32(expanded[central+24:], 10*1024*1024+1)
	if err := ValidateSkillArchive(expanded); err == nil || !strings.Contains(err.Error(), "10 MB") {
		t.Fatalf("expanded: %v", err)
	}
	for _, data := range [][]byte{nil, {1, 2, 3}, make([]byte, maxSkillBytes+1)} {
		if ValidateSkillArchive(data) == nil {
			t.Fatal("invalid archive accepted")
		}
	}
}
func TestPromptPluginUnicodeLimit(t *testing.T) {
	input := pluginInput{Name: " Name ", Version: " v1.0 ", Type: "filter", Text: strings.Repeat("😀", 500)}
	normalized, err := validatePlugin(input)
	if err != nil || normalized.Name != "Name" || normalized.Version != "v1.0" {
		t.Fatalf("%+v %v", normalized, err)
	}
	input.Text += "😀"
	if _, err = validatePlugin(input); err == nil {
		t.Fatal("501 Unicode codepoints accepted")
	}
	input.Type = "injection"
	input.Text = strings.Repeat("中", 5000)
	if _, err = validatePlugin(input); err != nil {
		t.Fatal(err)
	}
}
func TestAnnouncementPublicLocalization(t *testing.T) {
	item := AppAnnouncement{Enabled: true, ContentZh: " 中文 ", ContentEn: " English ", Link: " https://example.org "}
	public := presentAnnouncement(item, true)
	if public["content"] != "中文" || public["link"] != "https://example.org" || public["enabled"] != true {
		t.Fatal(public)
	}
	item.ContentEn = " "
	public = presentAnnouncement(item, true)
	if public["enabled"] != false || public["content"] != "" || public["link"] != "" {
		t.Fatal(public)
	}
	admin := presentAnnouncement(item, false)
	if admin["enabled"] != true || admin["contentZh"] != " 中文 " {
		t.Fatal(admin)
	}
}
func TestCurrencyEncryptionCompatibility(t *testing.T) {
	key := sha256.Sum256([]byte("codex-switch:currency-api:test-secret"))
	// Fixture generated with Node crypto.createCipheriv('aes-256-gcm'), a zero nonce and the same key.
	const fixture = "v1:AAAAAAAAAAAAAAAA:lu5BT0uBHIVpeY7NMNXjnQ:NvNJx4KWNC6gLKWL"
	fixturePlaintext, fixtureErr := decryptCurrency(fixture, key[:])
	if fixtureErr != nil || fixturePlaintext != "test-api-key" {
		t.Fatal(fixturePlaintext, fixtureErr)
	}
	encrypted, err := encryptCurrency("test-api-key", key[:])
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := decryptCurrency(encrypted, key[:])
	if err != nil || decrypted != "test-api-key" {
		t.Fatalf("%q %v", decrypted, err)
	}
	wrong := sha256.Sum256([]byte("wrong"))
	if _, err = decryptCurrency(encrypted, wrong[:]); err == nil {
		t.Fatal("wrong key accepted")
	}
	if _, err = decryptCurrency("v1:a:b:c", key[:]); err == nil {
		t.Fatal("invalid nonce accepted")
	}
}
func TestNormalizeCurrenciesAndPresets(t *testing.T) {
	values, err := normalizeCurrencies([]currencyItem{{" eur ", " Euro "}})
	if err != nil || values[0].Code != "EUR" || values[0].Name != "Euro" {
		t.Fatal(values, err)
	}
	for _, values := range [][]currencyItem{{{"USD", "Dollar"}}, {{"EUR", "Euro"}, {"eur", "Euro"}}, {{"EU", "Euro"}}} {
		if _, err := normalizeCurrencies(values); err == nil {
			t.Fatal("invalid currencies accepted")
		}
	}
	if _, err := normalizePresets([]homePreset{{Id: "a"}, {Id: " a "}}); err == nil {
		t.Fatal("duplicate normalized presets accepted")
	}
}
func TestChatPolicyCompatibility(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	delete(policy, "relayMaxFramesPerSecond")
	delete(policy, "videoPreviewMaxMb")
	parsed, err := parseChatPolicy(policy)
	if err != nil || parsed["relayMaxFramesPerSecond"] != float64(-1) {
		t.Fatal(parsed, err)
	}
	parsed["threadPageSize"] = 0.0
	if _, err := parseChatPolicy(parsed); err == nil {
		t.Fatal("zero page size accepted")
	}
	policy["relayMaxMbPerSecond"] = 0.0
	if _, err := parseChatPolicy(policy); err == nil {
		t.Fatal("zero relay limit accepted")
	}
	policy = defaultChatPolicy()
	policy["titleSettings"] = map[string]interface{}{"model": " model/name ", "effort": "xhigh"}
	parsed, err = parseChatPolicy(policy)
	if err != nil {
		t.Fatal(err)
	}
	if parsed["titleSettings"].(gin.H)["model"] != "model/name" {
		t.Fatal(parsed)
	}
}
func TestDashboardCumulativeTrend(t *testing.T) {
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	data := dashboardData{
		Summary: dashboardSummary{TotalInstallations: 10},
		Users:   []datedCount{{Date: "2026-09-02", Count: 2}},
		Installations: []datedCount{
			{Date: "2026-09-02", Platform: "windows", Count: 3},
		},
		Activity: []datedCount{
			{Date: "2026-09-02", Platform: "windows", Count: 2},
			{Date: "2026-09-02", Platform: "unsupported", Count: 4},
		},
	}
	trend, activity := buildDashboardTrend(data, start, 3)
	if trend[0]["totalInstallations"] != int64(7) || trend[1]["totalInstallations"] != int64(10) ||
		trend[2]["users"] != int64(0) {
		t.Fatal(trend)
	}
	if activity[1]["total"] != int64(2) {
		t.Fatal(activity)
	}
}
