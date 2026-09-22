package platform

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestLegacyValidationOracle(t *testing.T) {
	data, err := os.ReadFile("../../testdata/validation-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Schema, Label string
		Input         json.RawMessage
		Messages      []string
		Transformed   JSON
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	contract, err := LoadContract()
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Schema+"/"+fixture.Label, func(t *testing.T) {
			body, order, err := DecodeObject(fixture.Input)
			if err != nil {
				t.Fatal(err)
			}
			messages := contract.Validate(fixture.Schema, body, order)
			if !reflect.DeepEqual(messages, fixture.Messages) {
				t.Errorf("messages\nGo:   %#v\nNest: %#v", messages, fixture.Messages)
			}
			if len(messages) == 0 && !reflect.DeepEqual(body, fixture.Transformed) {
				t.Errorf("transform\nGo: %#v\nNest: %#v", body, fixture.Transformed)
			}
		})
	}
}
