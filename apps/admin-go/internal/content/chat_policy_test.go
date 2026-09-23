package content

import (
	"math"
	"testing"
)

func TestP2PPolicyDefaultsForOlderSettings(t *testing.T) {
	policy := defaultChatPolicy()
	delete(policy, "titleSettings")
	defaults := map[string]float64{
		"p2pNegotiationTimeoutSeconds": 45,
		"p2pRetryIntervalSeconds":      10,
		"p2pDisconnectGraceSeconds":    10,
	}
	for key := range defaults {
		delete(policy, key)
	}
	parsed, err := parseChatPolicy(policy)
	if err != nil {
		t.Fatal(err)
	}
	for key, expected := range defaults {
		if parsed[key] != expected {
			t.Fatalf("%s default: got %v, want %v", key, parsed[key], expected)
		}
	}
}

func TestP2PPolicyDurationsHaveNoProductUpperLimit(t *testing.T) {
	for _, key := range []string{"p2pNegotiationTimeoutSeconds", "p2pRetryIntervalSeconds", "p2pDisconnectGraceSeconds"} {
		policy := defaultChatPolicy()
		delete(policy, "titleSettings")
		for _, value := range []float64{1, 1_000_000, 9007199254740991} {
			policy[key] = value
			parsed, err := parseChatPolicy(policy)
			if err != nil || parsed[key] != value {
				t.Fatalf("%s=%v: got %v, error %v", key, value, parsed, err)
			}
		}
		for _, value := range []interface{}{0.0, -1.0, 1.5, math.NaN(), math.Inf(1), "45", nil} {
			policy[key] = value
			if _, err := parseChatPolicy(policy); err == nil {
				t.Fatalf("accepted %s=%v", key, value)
			}
		}
	}
}
