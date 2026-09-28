package devices

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"strings"
	"testing"
	"time"
)

func TestServiceCredentialCannotActAsViewerOrSubscriber(t *testing.T) {
	deps := &platform.Dependencies{Config: platform.Config{}}
	gateway := &ChatGateway{service: &Service{deps}}
	token := serviceCredentialPrefix + strings.Repeat("a", 64)
	if _, err := gateway.authenticate(platform.JSON{"type": "authenticate", "role": "mobile",
		"deviceId": "0f992083-ff67-4937-8519-77a54d252bce", "accessToken": token}); err == nil {
		t.Fatal("service credential accepted for viewer")
	}
	if _, _, err := socketIdentity(deps, token); err == nil {
		t.Fatal("service credential accepted as account JWT")
	}
	if _, _, err := gateway.service.deviceIdentity(token, "device"); err == nil {
		t.Fatal("disabled service accepted")
	}
}

func TestInteractiveHostHasPriorityOverUnattendedHost(t *testing.T) {
	sessions := newChatSessions(nil)
	identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
	service := sessionLimitPeer(t)
	service.serviceHost.Store(true)
	if err := sessions.join(service, identity, platform.JSON{"transportVersion": float64(2)}, nil); err != nil {
		t.Fatal(err)
	}
	interactive := joinLimitPeer(t, sessions, identity, 2)
	if !service.closed.Load() || interactive.closed.Load() {
		t.Fatal("interactive host did not replace service")
	}
	replacement := sessionLimitPeer(t)
	replacement.serviceHost.Store(true)
	if err := sessions.join(replacement, identity, platform.JSON{"transportVersion": float64(2)}, nil); err != nil {
		t.Fatal(err)
	}
	if !replacement.closed.Load() || sessions.desktops["owner:pc"] != interactive {
		t.Fatal("service displaced active host")
	}
}
