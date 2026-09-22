package accounts

import (
	"errors"
	"math"
	"strings"
	"time"
)

var accountFields = []string{
	"auth",
	"note",
	"expiresAt",
	"privateDetails",
	"usage",
	"active",
	"autoSwitchPriority",
	"autoSwitchThreshold",
}
var providerFields = []string{"kind", "name", "group", "baseUrl", "apiKey", "model", "models", "modelReasoningEfforts",
	"modelContextWindows", "modelApiFormats", "imageInputModels", "contextWindow", "modelSelectionControlledByCodex",
	"fastModeEnabled", "apiFormat", "balancePlatform", "balanceQueryUrl", "balanceQueryToken", "walletQueryUrl",
	"walletQueryToken", "walletUsername", "walletPassword"}

func accountDTO(row account) object {
	result := object{
		"id":                  row.AccountID,
		"email":               row.Email,
		"note":                row.Note,
		"expiresAt":           row.ExpiresAt,
		"plan":                row.Plan,
		"accountId":           row.CodexAccountID,
		"active":              row.Active,
		"autoSwitchPriority":  row.AutoSwitchPriority,
		"autoSwitchThreshold": row.AutoSwitchThreshold,
		"usage":               obj(row.Usage),
		"auth":                obj(row.Auth),
		"lastModifiedAt": iso(
			row.LastModifiedAt,
		),
		"fieldModifiedAt": versions(row.FieldModifiedAt, iso(row.LastModifiedAt), accountFields),
	}
	private := object{
		"password":    str(row.PrivateDetails["password"]),
		"phoneNumber": str(row.PrivateDetails["phoneNumber"]),
		"totpSecret":  str(row.PrivateDetails["totpSecret"]),
	}
	if first(private["password"], private["phoneNumber"], private["totpSecret"]) != "" {
		result["privateDetails"] = private
	}
	return result
}

func mergeAccount(existing *account, owner string, incoming object) (*account, bool, error) {
	if existing != nil && existing.DeletedAt != nil {
		return nil, false, nil
	}
	inVersions := versions(obj(incoming["fieldModifiedAt"]), incoming["lastModifiedAt"], accountFields)
	incoming = copyObject(incoming)
	if existing == nil {
		row, err := newIncomingAccount(owner, incoming, inVersions)
		return row, true, err
	}
	current := accountDTO(*existing)
	current["privateDetails"] = obj(existing.PrivateDetails)
	oldVersions := obj(current["fieldModifiedAt"])
	legacyBlocked := !hasVersions(obj(incoming["fieldModifiedAt"])) && hasVersions(existing.FieldModifiedAt)
	changed, active := false, false
	for _, key := range accountFields {
		if !newer(inVersions[key], oldVersions[key]) {
			continue
		}
		if skipAccountField(key, incoming, legacyBlocked) {
			continue
		}
		if incoming[key] == nil && (key == "privateDetails" || strings.HasPrefix(key, "autoSwitch")) {
			return nil, false, errors.New("synced account required field cannot be null")
		}
		applyAccountField(current, incoming, key)
		oldVersions[key] = inVersions[key]
		changed = true
		if key == "active" {
			active = true
		}
	}
	if !changed {
		return nil, false, nil
	}
	current["id"] = existing.ID
	current["ownerId"] = owner
	current["codexAccountId"] = current["accountId"]
	current["accountId"] = existing.AccountID
	current["lastModifiedAt"] = latest(oldVersions)
	current["createdAt"] = iso(existing.CreatedAt)
	row := &account{}
	err := decodeMap(current, row)
	return row, active, err
}

func applyAccountField(current, incoming object, key string) {
	current[key] = valueOr(incoming[key], fieldDefault(key))
	if key == "auth" {
		for _, field := range []string{"email", "plan", "accountId"} {
			current[field] = incoming[field]
		}
	}
	if key == "usage" && str(obj(incoming["usage"])["plan"]) != "" {
		current["plan"] = obj(incoming["usage"])["plan"]
	}
}

func newIncomingAccount(owner string, incoming, inVersions object) (*account, error) {
	values := copyObject(incoming)
	values["privateDetails"] = valueOr(incoming["privateDetails"], object{})
	values["accountId"] = incoming["id"]
	values["codexAccountId"] = incoming["accountId"]
	values["id"] = newID()
	values["ownerId"] = owner
	values["fieldModifiedAt"] = inVersions
	values["lastModifiedAt"] = latest(inVersions)
	row := &account{}
	err := decodeMap(values, row)
	return row, err
}

func skipAccountField(key string, incoming object, legacyBlocked bool) bool {
	protected := key == "note" || key == "expiresAt" || strings.HasPrefix(key, "autoSwitch")
	optional := key == "privateDetails" || strings.HasPrefix(key, "autoSwitch")
	return (protected && legacyBlocked) || (optional && !has(incoming, key))
}

func fieldDefault(key string) interface{} {
	switch key {
	case "note", "expiresAt", "group":
		return ""
	case "privateDetails", "usage":
		return object{}
	case "active":
		return false
	}
	return float64(0)
}

func providerValues(in object) object {
	result := object{}
	for _, key := range providerFields {
		result[key] = in[key]
	}
	result["kind"] = valueOr(in["kind"], "custom")
	result["group"] = strings.TrimSpace(str(in["group"]))
	for _, key := range []string{"models", "imageInputModels"} {
		result[key] = valueOr(in[key], []string{})
	}
	for _, key := range []string{"fastModeEnabled", "modelSelectionControlledByCodex"} {
		result[key] = valueOr(in[key], false)
	}
	for _, key := range []string{"modelReasoningEfforts", "modelContextWindows", "modelApiFormats"} {
		result[key] = normalizeModels(key, obj(in[key]), stringsOf(in["models"]))
	}
	return result
}

func normalizeModels(key string, configured object, models []string) object {
	result := object{}
	for _, model := range models {
		value := configured[model]
		switch key {
		case "modelReasoningEfforts":
			valid := []string{}
			for _, effort := range stringsOf(value) {
				if strings.Contains("|none|low|medium|high|xhigh|max|ultra|", "|"+effort+"|") && effort != "" {
					valid = append(valid, effort)
				}
			}
			if len(valid) > 0 {
				result[model] = unique(valid)
			}
		case "modelContextWindows":
			n := number(value)
			if n > 0 && n <= 9007199254740991 && n == math.Trunc(n) {
				result[model] = n
			}
		case "modelApiFormats":
			if value == "openaiResponses" || value == "openaiChat" {
				result[model] = value
			}
		}
	}
	return result
}

func providerDTO(row provider) object {
	result := providerValues(encodeMap(row))
	result["id"] = row.ProviderID
	result["lastModifiedAt"] = iso(row.LastModifiedAt)
	result["fieldModifiedAt"] = versions(row.FieldModifiedAt, iso(row.LastModifiedAt), providerFields)
	return result
}

func mergeProvider(existing *provider, owner string, incoming object) (*provider, error) {
	if existing != nil && existing.DeletedAt != nil {
		return nil, nil
	}
	values := providerValues(incoming)
	incomingVersions := versions(obj(incoming["fieldModifiedAt"]), incoming["lastModifiedAt"], providerFields)
	values["id"] = newID()
	values["ownerId"] = owner
	values["providerId"] = incoming["id"]
	values["fieldModifiedAt"] = incomingVersions
	if existing != nil {
		if !hasVersions(obj(incoming["fieldModifiedAt"])) && hasVersions(existing.FieldModifiedAt) {
			return nil, nil
		}
		old := encodeMap(existing)
		oldVersions := versions(existing.FieldModifiedAt, iso(existing.LastModifiedAt), providerFields)
		changed := false
		for _, key := range providerFields {
			if newer(incomingVersions[key], oldVersions[key]) {
				old[key] = values[key]
				oldVersions[key] = incomingVersions[key]
				changed = true
			}
		}
		if !changed {
			return nil, nil
		}
		values = old
		values["fieldModifiedAt"] = oldVersions
	}
	values["lastModifiedAt"] = latest(obj(values["fieldModifiedAt"]))
	row := &provider{}
	err := decodeMap(values, row)
	return row, err
}

// mergeVault keeps deletions as versioned tombstones; deletion wins equal timestamps.
func mergeVault(stored *vault, incoming object) object {
	entries, tombstones := []object{}, []object{}
	if stored != nil {
		normalized := normalizeVault(versionEntries(stored.Entries, iso(stored.ModifiedAt)), stored.Tombstones)
		entries = normalized["entries"].([]object)
		tombstones = normalized["tombstones"].([]object)
	}
	if incoming != nil {
		newEntries := []object{}
		for _, v := range arr(incoming["entries"]) {
			newEntries = append(newEntries, obj(v))
		}
		newEntries = versionEntries(newEntries, str(incoming["modifiedAt"]))
		if !has(incoming, "tombstones") {
			ids := map[string]bool{}
			for _, v := range newEntries {
				ids[str(v["id"])] = true
			}
			for _, v := range entries {
				if !ids[str(v["id"])] {
					tombstones = append(tombstones, object{"id": v["id"], "deletedAt": incoming["modifiedAt"]})
				}
			}
		}
		entries = append(entries, newEntries...)
		for _, v := range arr(incoming["tombstones"]) {
			tombstones = append(tombstones, obj(v))
		}
	}
	return normalizeVault(entries, tombstones)
}

func versionEntries(entries []object, fallback string) []object {
	result := []object{}
	for _, v := range entries {
		value := copyObject(v)
		if date(value["updatedAt"]).IsZero() {
			value["updatedAt"] = fallback
		}
		result = append(result, value)
	}
	return result
}

func normalizeVault(entries, tombstones []object) object {
	active, deleted := map[string]object{}, map[string]object{}
	ids := []string{}
	for _, v := range entries {
		id := str(v["id"])
		if active[id] == nil {
			ids = append(ids, id)
		}
		if !newer(active[id]["updatedAt"], v["updatedAt"]) {
			active[id] = v
		}
	}
	for _, v := range tombstones {
		id := str(v["id"])
		if active[id] == nil && deleted[id] == nil {
			ids = append(ids, id)
		}
		if !newer(deleted[id]["deletedAt"], v["deletedAt"]) {
			deleted[id] = v
		}
	}
	a, d := []object{}, []object{}
	modified := epoch
	for _, id := range ids {
		if active[id] != nil && (deleted[id] == nil || newer(active[id]["updatedAt"], deleted[id]["deletedAt"])) {
			a = append(a, active[id])
			if newer(active[id]["updatedAt"], modified) {
				modified = str(active[id]["updatedAt"])
			}
		} else if deleted[id] != nil {
			d = append(d, deleted[id])
			if newer(deleted[id]["deletedAt"], modified) {
				modified = str(deleted[id]["deletedAt"])
			}
		}
	}
	return object{"entries": a, "tombstones": d, "modifiedAt": modified}
}

func now() time.Time { return time.Now().UTC() }
