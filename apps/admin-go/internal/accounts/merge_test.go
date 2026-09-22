package accounts

import (
	"reflect"
	"testing"
)

const testOld = "2026-01-01T00:00:00.000Z"
const testNew = "2026-02-01T00:00:00.000Z"

func accountFixture() object {
	return object{
		"id":                  "fixture-account",
		"email":               "fixture@example.test",
		"note":                "old note",
		"expiresAt":           "2027-01-01",
		"plan":                "plus",
		"active":              false,
		"auth":                object{"tokens": object{"access_token": "opaque"}},
		"usage":               object{},
		"lastModifiedAt":      testOld,
		"autoSwitchPriority":  float64(2),
		"autoSwitchThreshold": float64(12),
	}
}

func TestAccountFieldMergePreservesConcurrentMetadata(t *testing.T) {
	old, _, err := mergeAccount(nil, "owner", accountFixture())
	if err != nil {
		t.Fatal(err)
	}
	in := accountFixture()
	in["note"] = "stale note"
	in["usage"] = object{"plan": "pro", "remainingPercent": float64(85)}
	in["fieldModifiedAt"] = object{"usage": testNew}
	in["lastModifiedAt"] = testOld
	merged, active, err := mergeAccount(old, "owner", in)
	if err != nil {
		t.Fatal(err)
	}
	if merged == nil || merged.Note != "old note" || merged.Plan != "pro" || active {
		t.Fatalf("unexpected merged state: %#v, active=%v", merged, active)
	}
	if merged.LastModifiedAt != date(testNew) {
		t.Fatalf("version changed incorrectly: %v", merged.LastModifiedAt)
	}
}

func TestLegacyAccountCannotOverwriteVersionedSettings(t *testing.T) {
	old, _, _ := mergeAccount(nil, "owner", accountFixture())
	in := accountFixture()
	in["lastModifiedAt"] = testNew
	in["note"] = "stale"
	in["autoSwitchPriority"] = float64(99)
	merged, _, err := mergeAccount(old, "owner", in)
	if err != nil {
		t.Fatal(err)
	}
	if merged.Note != old.Note || merged.AutoSwitchPriority != old.AutoSwitchPriority {
		t.Fatalf("legacy payload overwrote settings: %#v", merged)
	}
}

func TestMissingPrivateDetailsNeverClearsSecrets(t *testing.T) {
	in := accountFixture()
	in["privateDetails"] = object{"password": "private", "phoneNumber": "123", "totpSecret": "ABCDEF"}
	old, _, _ := mergeAccount(nil, "owner", in)
	newer := accountFixture()
	newer["lastModifiedAt"] = testNew
	merged, _, err := mergeAccount(old, "owner", newer)
	if err != nil {
		t.Fatal(err)
	}
	if merged.PrivateDetails["password"] != "private" {
		t.Fatal("omitted private details cleared stored credentials")
	}
	newer["fieldModifiedAt"] = object{"privateDetails": testNew}
	newer["privateDetails"] = object{}
	merged, _, err = mergeAccount(old, "owner", newer)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.PrivateDetails) != 0 {
		t.Fatal("explicit newer clear was ignored")
	}
}

func TestAdminOptionalNullMatchesLegacyStorageContract(t *testing.T) {
	patch, err := normalizeAdminPatch(object{"note": nil, "expiresAt": nil, "usage": nil, "accountId": nil})
	if err != nil {
		t.Fatal(err)
	}
	if patch["note"] != "" || patch["expiresAt"] != "" || len(obj(patch["usage"])) != 0 || patch["accountId"] != nil {
		t.Fatalf("unexpected normalized patch: %#v", patch)
	}
	for _, key := range []string{"email", "plan", "active", "auth"} {
		if _, err = normalizeAdminPatch(object{key: nil}); err == nil {
			t.Fatalf("null required field accepted: %s", key)
		}
	}
}

func TestAdminJSONReplacementRemovesOldCredentialKeys(t *testing.T) {
	row, _, err := mergeAccount(nil, "owner", accountFixture())
	if err != nil {
		t.Fatal(err)
	}
	row.Usage = object{"old": "usage"}
	row.Auth = object{"tokens": object{"access_token": "old", "refresh_token": "secret"}}
	updated, err := applyAdminPatch(*row, object{"usage": nil, "auth": object{"tokens": object{"access_token": "new"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Usage) != 0 {
		t.Fatal("cleared usage retained old keys")
	}
	if _, exists := obj(updated.Auth["tokens"])["refresh_token"]; exists {
		t.Fatal("replaced credential retained old refresh token")
	}
	if obj(row.Auth["tokens"])["refresh_token"] != "secret" {
		t.Fatal("pure patch unexpectedly mutated the original row")
	}
}

func TestSoftDeletedAccountNeverResurrectsOnSync(t *testing.T) {
	old, _, _ := mergeAccount(nil, "owner", accountFixture())
	deleted := now()
	old.DeletedAt = &deleted
	in := accountFixture()
	in["lastModifiedAt"] = testNew
	merged, _, err := mergeAccount(old, "owner", in)
	if err != nil || merged != nil {
		t.Fatalf("deleted account resurrected: %#v %v", merged, err)
	}
}

func TestProviderMergesIndependentFieldVersions(t *testing.T) {
	in := object{
		"id":             "p1",
		"name":           "old",
		"apiKey":         "secret",
		"models":         []interface{}{"gpt"},
		"model":          "gpt",
		"baseUrl":        "https://example.test",
		"apiFormat":      "openaiResponses",
		"lastModifiedAt": testOld,
	}
	old, err := mergeProvider(nil, "owner", in)
	if err != nil {
		t.Fatal(err)
	}
	in["name"] = "stale"
	in["apiKey"] = "updated"
	in["fieldModifiedAt"] = object{"apiKey": testNew}
	merged, err := mergeProvider(old, "owner", in)
	if err != nil {
		t.Fatal(err)
	}
	if merged.APIKey != "updated" || merged.Name != "old" {
		t.Fatalf("unexpected provider merge: %#v", merged)
	}
	delete(in, "fieldModifiedAt")
	in["lastModifiedAt"] = testNew
	merged, err = mergeProvider(old, "owner", in)
	if err != nil || merged != nil {
		t.Fatal("legacy provider overwrote field versions")
	}
}

func TestModelNormalizationRejectsUnknownAndInvalidValues(t *testing.T) {
	models := []string{"model"}
	result := normalizeModels(
		"modelReasoningEfforts",
		object{"model": []interface{}{"high", "high", "unknown", "max"}, "other": []interface{}{"low"}},
		models,
	)
	if !reflect.DeepEqual(result, object{"model": []string{"high", "max"}}) {
		t.Fatalf("unexpected efforts: %#v", result)
	}
	for _, value := range []float64{-1, 0, 1.5, 9007199254740992} {
		if len(normalizeModels("modelContextWindows", object{"model": value}, models)) != 0 {
			t.Fatalf("invalid context accepted: %v", value)
		}
	}
}

func TestVaultDeleteWinsTiesAndNewerEntryRestores(t *testing.T) {
	entry := object{"id": "entry", "issuer": "test", "updatedAt": testOld}
	result := normalizeVault([]object{entry}, []object{{"id": "entry", "deletedAt": testOld}})
	if len(result["entries"].([]object)) != 0 || len(result["tombstones"].([]object)) != 1 {
		t.Fatal("deletion did not win tie")
	}
	entry["updatedAt"] = testNew
	result = normalizeVault([]object{entry}, []object{{"id": "entry", "deletedAt": testOld}})
	if len(result["entries"].([]object)) != 1 || len(result["tombstones"].([]object)) != 0 {
		t.Fatal("newer entry failed to restore")
	}
}

func TestLegacyVaultOmissionCreatesTombstone(t *testing.T) {
	stored := &vault{
		Entries:    []object{{"id": "removed", "updatedAt": testOld}, {"id": "concurrent", "updatedAt": testNew}},
		ModifiedAt: date(testNew),
	}
	merged := mergeVault(stored, object{"entries": []interface{}{}, "modifiedAt": testOld})
	entries := merged["entries"].([]object)
	deleted := merged["tombstones"].([]object)
	if len(entries) != 1 || entries[0]["id"] != "concurrent" || len(deleted) != 1 || deleted[0]["id"] != "removed" {
		t.Fatalf("legacy omission lost concurrent edit: %#v", merged)
	}
	merged = mergeVault(
		stored,
		object{"entries": []interface{}{}, "tombstones": []interface{}{}, "modifiedAt": testNew},
	)
	if len(merged["entries"].([]object)) != 2 {
		t.Fatal("explicit empty tombstone list deleted entries")
	}
}
