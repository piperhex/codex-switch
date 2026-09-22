package platform

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestJSONDatesAndAnonymousLegacyDTOs(t *testing.T) {
	type entity struct {
		Date   time.Time `json:"date"`
		Hidden string    `json:"-"`
		Count  int       `json:"count"`
	}
	type response struct {
		entity
		ID        string `json:"id"`
		Optional  string `json:"optional,omitempty"`
		UserValue string `json:"userValue"`
	}
	value := response{entity: entity{Date: time.Date(2026, 9, 22, 18, 30, 0, 123456789, time.FixedZone("UTC+8", 8*3600))},
		ID: "fixture", UserValue: "2026-09-22T00:00:00.123456789Z"}
	encoded, err := json.Marshal(JSONValue(value))
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]interface{}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	expected := map[string]interface{}{"id": "fixture", "date": "2026-09-22T10:30:00.123Z", "count": float64(0), "userValue": value.UserValue}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %#v, want %#v", actual, expected)
	}
}
