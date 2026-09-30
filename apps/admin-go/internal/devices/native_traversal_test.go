package devices

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"strings"
	"testing"
	"time"
)

func TestNativeTraversalConfiguration(t *testing.T) {
	valid := platform.Config{"CHAT_NATIVE_PEERS": "udp://peer.example:11010,tcp://[2001:db8::1]:11010",
		"CHAT_NATIVE_STUN": "stun.example:3478,[2001:db8::2]:3478"}
	if config, err := nativeTraversalConfig(valid); err != nil || config == nil {
		t.Fatal("valid config rejected", err)
	}
	for _, value := range []string{"https://peer.example:11010", "udp://u:p@peer.example:11010",
		"udp://peer.example:80", "udp://peer.example:11010/path", "udp://peer.example:11010?token=secret"} {
		config := platform.Config{"CHAT_NATIVE_PEERS": value, "CHAT_NATIVE_STUN": valid["CHAT_NATIVE_STUN"]}
		if _, err := nativeTraversalConfig(config); err == nil {
			t.Errorf("accepted invalid server %s", value)
		}
	}
	if config, err := nativeTraversalConfig(platform.Config{}); err != nil || config != nil {
		t.Fatal("default enabled")
	}
	if _, err := nativeTraversalConfig(platform.Config{"CHAT_NATIVE_PEERS": "udp://peer.example:11010"}); err == nil {
		t.Fatal("NAT detection requires multiple STUN endpoints")
	}
}

func TestNativeTraversalNegotiationAndRenewal(t *testing.T) {
	for _, capabilities := range [][3]bool{{false, true, true}, {true, false, true}, {true, true, false}, {true, true, true}} {
		enabled := capabilities[0] && capabilities[1] && capabilities[2]
		sessions := newChatSessions(nil)
		if capabilities[2] {
			sessions.hot.nativeConfig = platform.JSON{
				"servers": []string{"udp://peer.example:11010"}, "stunServers": []string{"stun.example:3478"}}
		}
		desktop, mobile := queuedPeer(), queuedPeer()
		identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
		if err := sessions.join(desktop, identity, platform.JSON{"transportVersion": float64(2),
			"nativeTraversal": capabilities[0]}, nil); err != nil {
			t.Fatal(err)
		}
		updateFrame(t, desktop)
		identity.role = "mobile"
		if err := sessions.join(mobile, identity, platform.JSON{"transportVersion": float64(2),
			"nativeTraversal": capabilities[1], "publicKey": strings.Repeat("ab", 32)}, nil); err != nil {
			t.Fatal(err)
		}
		opened, paired := updateFrame(t, desktop), updateFrame(t, mobile)
		if (opened["nativeTraversal"] != nil) != enabled || (paired["nativeTraversal"] != nil) != enabled {
			t.Fatal("native capability mismatch")
		}
		mobile.closeOnce.Do(func() { mobile.closed.Store(true) })
		resumed := queuedPeer()
		if err := sessions.join(resumed, identity, platform.JSON{"transportVersion": float64(2),
			"nativeTraversal": capabilities[1], "resume": platform.JSON{"sessionId": paired["sessionId"],
				"resumeToken": paired["resumeToken"]}}, nil); err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []*peer{desktop, resumed} {
			frame := updateFrame(t, endpoint)
			if (frame["nativeTraversal"] != nil) != enabled {
				t.Fatal("resume capability mismatch")
			}
			if enabled {
				config := frame["nativeTraversal"].(map[string]interface{})
				original := paired["nativeTraversal"].(map[string]interface{})
				if config["secret"] != original["secret"] || config["expiresAt"] != frame["expiresAt"] {
					t.Fatal("renewal changed credentials or lost lease")
				}
			}
		}
	}
}

func TestNativeSecretsAreIsolatedBySessionAndCredential(t *testing.T) {
	sessions := newHotSessions(nil)
	sessions.nativeConfig = platform.JSON{}
	session := &hotSession{id: "first", token: "token-a", native: true, expires: time.Now().Add(time.Minute)}
	first := sessions.nativeTraversal(session)["secret"]
	session.id = "second"
	second := sessions.nativeTraversal(session)["secret"]
	session.id = "first"
	session.token = "token-b"
	if first == second || first == sessions.nativeTraversal(session)["secret"] {
		t.Fatal("shared session secret")
	}
}
