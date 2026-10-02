package identity

import (
	"strings"
	"testing"
)

func TestTemplateBrandingPreservesSavedCustomerContent(t *testing.T) {
	definition, err := findTemplate(officialAccountBoundCode)
	if err != nil {
		t.Fatal(err)
	}
	defaults := presentTemplate(*definition, nil)
	if !strings.Contains(defaults["body"].(string), "登录 Remote AI") || defaults["customized"] != false {
		t.Fatalf("unexpected default template: %v", defaults)
	}
	saved := emailTemplate{Subject: "Custom Codex Switch subject", Body: "Our saved Codex Switch message"}
	customized := presentTemplate(*definition, &saved)
	if customized["subject"] != saved.Subject || customized["body"] != saved.Body || customized["customized"] != true {
		t.Fatalf("saved template was rewritten: %v", customized)
	}
}
