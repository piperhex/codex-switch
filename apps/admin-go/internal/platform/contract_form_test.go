package platform

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestLegacyExtendedFormOracle(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/form-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Raw   string
		Value JSON
		Order PropertyOrder
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Raw, func(t *testing.T) {
			value, order, err := parseExtendedForm(fixture.Raw, "utf-8")
			if err != nil || !reflect.DeepEqual(value, fixture.Value) {
				t.Fatalf("value = %#v, error = %v; want %#v", value, err, fixture.Value)
			}
			for path, keys := range fixture.Order {
				objectKeys := order[path]
				object := JSON{}
				for _, key := range objectKeys {
					object[key] = true
				}
				if !reflect.DeepEqual(orderedKeys(object, objectKeys), keys) {
					t.Fatalf("property order %q = %v; want %v", path, objectKeys, keys)
				}
			}
		})
	}
}
