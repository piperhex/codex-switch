package devices

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"testing"
	"time"
)

func TestDesktopTURNURLValidation(t *testing.T) {
	for _, input := range []string{"", "turn:relay.example:3479?transport=udp,turn:relay.example:3479?transport=tcp",
		"turns:relay.example:5349?transport=tcp", "turn:[2001:db8::1]:3479"} {
		if _, err := desktopTURNURLs(input); err != nil {
			t.Fatalf("rejected %q: %v", input, err)
		}
	}
	for _, input := range []string{"http://relay.example", "turn:relay.example", "turn:relay.example:0",
		"turn:relay.example:65536", "turn:user@relay.example:3479", "turns:relay.example:5349?transport=udp",
		"turn:relay.example:3479?secret=x", "turn:relay.example:3479?transport=udp&transport=tcp"} {
		if _, err := desktopTURNURLs(input); err == nil {
			t.Fatalf("accepted %q", input)
		}
	}
}

func TestDesktopCredentialsRefreshOnlyAuthenticatedDesktopConnections(t *testing.T) {
	desktop, mobile, expired, anonymous := queuedPeer(), queuedPeer(), queuedPeer(), queuedPeer()
	future := time.Now().Add(time.Hour)
	gateway := &ChatGateway{sessions: newChatSessions(nil), connections: map[*peer]*chatConnection{
		desktop:   {identity: &chatIdentity{role: "desktop", owner: "owner", expires: future}},
		mobile:    {identity: &chatIdentity{role: "mobile", expires: future}},
		expired:   {identity: &chatIdentity{role: "desktop", expires: time.Now().Add(-time.Second)}},
		anonymous: {},
	}}
	gateway.sessions.desktopICE = func(owner string, expires time.Time) []platform.JSON {
		if owner != "owner" || !expires.Equal(future) {
			t.Fatal("identity was not preserved")
		}
		return []platform.JSON{{"urls": "turn:example.test:3479"}}
	}
	gateway.refreshDesktopICE()
	if updateFrame(t, desktop)["type"] != "desktop-ice" {
		t.Fatal("missing credential renewal")
	}
	for _, client := range []*peer{mobile, expired, anonymous} {
		if len(client.queue) != 0 {
			t.Fatal("credentials sent to ineligible connection")
		}
	}
}
