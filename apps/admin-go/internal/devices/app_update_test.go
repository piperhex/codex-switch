package devices

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func updateFrame(t *testing.T, client *peer) platform.JSON {
	t.Helper()
	select {
	case frame := <-client.queue:
		var value platform.JSON
		if err := json.Unmarshal(frame.bytes, &value); err != nil {
			t.Fatal(err)
		}
		return value
	default:
		t.Fatal("expected queued update frame")
		return nil
	}
}

func TestAppUpdateRoutesOnlyToOwnedSocketAndOriginalRequester(t *testing.T) {
	g := newControlGateway(nil)
	mobile, desktop, other := queuedPeer(), queuedPeer(), queuedPeer()
	g.sockets["owner:device"] = desktop
	request := platform.JSON{"deviceId": "device", "requestId": "read-1", "action": "status"}
	g.forwardAppUpdate(mobile, "intruder", request)
	if updateFrame(t, mobile)["error"] == "" || len(desktop.queue) != 0 {
		t.Fatal("cross-account request reached the desktop")
	}
	g.forwardAppUpdate(mobile, "owner", request)
	forwarded := updateFrame(t, desktop)
	reply := platform.JSON{"commandId": forwarded["commandId"], "data": platform.JSON{"currentVersion": "1.5.0"}}
	for _, session := range []controlSession{{owner: "intruder", device: "device"}, {owner: "owner", device: "other"}} {
		g.receiveAppUpdate(desktop, session, reply)
	}
	g.receiveAppUpdate(other, controlSession{owner: "owner", device: "device"}, reply)
	if len(mobile.queue) != 0 || len(g.updates) != 1 {
		t.Fatal("unrelated desktop completed another device's request")
	}
	g.receiveAppUpdate(desktop, controlSession{owner: "owner", device: "device"}, reply)
	if updateFrame(t, mobile)["requestId"] != "read-1" || len(g.updates) != 0 {
		t.Fatal("result did not reach original requester")
	}
	g.receiveAppUpdate(desktop, controlSession{owner: "owner", device: "device"}, reply)
	if len(mobile.queue) != 0 {
		t.Fatal("duplicate reply was delivered")
	}
}

func TestAppUpdateBoundsPendingRequestsAndCleansDisconnectedSockets(t *testing.T) {
	g := newControlGateway(nil)
	mobile, desktop := queuedPeer(), queuedPeer()
	g.sockets["owner:device"] = desktop
	request := platform.JSON{"deviceId": "device", "requestId": "install", "action": "install", "version": "1.6.0"}
	g.forwardAppUpdate(mobile, "owner", request)
	first := updateFrame(t, desktop)
	g.forwardAppUpdate(mobile, "owner", request)
	if updateFrame(t, mobile)["error"] == "" || len(desktop.queue) != 0 {
		t.Fatal("duplicate in-flight installation was forwarded")
	}
	g.mu.Lock()
	g.disconnectAppUpdates(desktop)
	g.mu.Unlock()
	if updateFrame(t, mobile)["error"] == "" || len(g.updates) != 0 {
		t.Fatal("disconnect did not fail pending command")
	}
	g.expireAppUpdate(first["commandId"].(string))
	if len(mobile.queue) != 0 {
		t.Fatal("expired command replied twice")
	}
}

func TestAppUpdateValidationAndTimeout(t *testing.T) {
	g := newControlGateway(nil)
	mobile, desktop := queuedPeer(), queuedPeer()
	g.requestAppUpdate(mobile, controlSession{owner: "owner"}, platform.JSON{
		"requestId": "invalid", "deviceId": "device", "action": "install",
	})
	if updateFrame(t, mobile)["error"] == "" {
		t.Fatal("invalid install was accepted")
	}
	g.sockets["owner:device"] = desktop
	g.forwardAppUpdate(mobile, "owner", platform.JSON{"deviceId": "device", "requestId": "check", "action": "check"})
	command := updateFrame(t, desktop)["commandId"].(string)
	g.updates[command].timer.Stop()
	g.expireAppUpdate(command)
	if updateFrame(t, mobile)["error"] == "" || len(g.updates) != 0 {
		t.Fatal("timeout did not release pending command")
	}
	if !supportedCapability("app-update") || checkCapability(&Device{}, commandSpec{capability: "app-update"}) == nil {
		t.Fatal("update capability was not enforced")
	}
}

func TestAppUpdateRejectsExpiredSubscriberAuthentication(t *testing.T) {
	g := newControlGateway(nil)
	client := queuedPeer()
	g.sessions[client] = controlSession{owner: "owner", kind: "subscriber", expires: time.Now().Add(-time.Second)}
	if err := g.receive(client, platform.JSON{"type": "app-update", "action": "install"}, nil); err == nil {
		t.Fatal("expired subscriber could send update commands")
	}
}
