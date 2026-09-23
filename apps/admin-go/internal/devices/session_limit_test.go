package devices

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func sessionLimitPeer(t *testing.T) *peer {
	t.Helper()
	peers := make(chan *peer, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		peers <- newPeer(socket)
	}))
	t.Cleanup(server.Close)
	socket, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	client := <-peers
	t.Cleanup(func() { client.terminate(); socket.Close() })
	return client
}

func joinLimitPeer(t *testing.T, sessions *chatSessions, identity chatIdentity, version float64) *peer {
	t.Helper()
	client := sessionLimitPeer(t)
	message := platform.JSON{"transportVersion": version, "publicKey": strings.Repeat("ab", 32)}
	if err := sessions.join(client, identity, message, nil); err != nil {
		t.Fatal(err)
	}
	return client
}

func TestChatSessionLimitCountsMixedTransportsPerComputer(t *testing.T) {
	for _, limit := range []int{5, 2, 8} {
		t.Run(fmt.Sprint(limit), func(t *testing.T) {
			sessions := newChatSessions(nil)
			if limit != 5 {
				sessions.setLimit(float64(limit))
			}
			identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
			joinLimitPeer(t, sessions, identity, 2)
			identity.role = "mobile"
			for index := range limit {
				if joinLimitPeer(t, sessions, identity, float64(1+index%2)).closed.Load() {
					t.Fatalf("connection %d rejected below limit %d", index+1, limit)
				}
			}
			if !joinLimitPeer(t, sessions, identity, 2).closed.Load() {
				t.Fatal("accepted a connection above the configured limit")
			}
			identity.device, identity.role = "another-pc", "desktop"
			joinLimitPeer(t, sessions, identity, 2)
			identity.role = "mobile"
			if joinLimitPeer(t, sessions, identity, 2).closed.Load() {
				t.Fatal("another computer shared the first computer's limit")
			}
		})
	}
}

func TestChatSessionLimitChangesPreserveExistingSessions(t *testing.T) {
	sessions := newChatSessions(nil)
	identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
	joinLimitPeer(t, sessions, identity, 2)
	identity.role = "mobile"
	first := joinLimitPeer(t, sessions, identity, 2)
	second := joinLimitPeer(t, sessions, identity, 1)
	sessions.setLimit(1)
	if first.closed.Load() || second.closed.Load() {
		t.Fatal("lowering the limit closed existing connections")
	}
	if !joinLimitPeer(t, sessions, identity, 2).closed.Load() {
		t.Fatal("lowered limit did not apply to a new connection")
	}
	sessions.setLimit(3)
	if joinLimitPeer(t, sessions, identity, 2).closed.Load() {
		t.Fatal("raised limit did not allow another connection")
	}
	sessions.disconnect(second, true)
	if joinLimitPeer(t, sessions, identity, 1).closed.Load() {
		t.Fatal("closing a session did not release its slot")
	}
}

func TestLowerLimitAllowsKnownResumeClaimsButRejectsReconstructionAboveLimit(t *testing.T) {
	sessions := newHotSessions(nil)
	identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
	claims := []interface{}{}
	for index := range 5 {
		claims = append(claims, map[string]interface{}{
			"sessionId": fmt.Sprint(index), "resumeToken": strings.Repeat("ab", 32),
		})
	}
	if err := sessions.register(queuedPeer(), identity, claims); err != nil {
		t.Fatal(err)
	}
	sessions.limit = 1
	if err := sessions.register(queuedPeer(), identity, claims); err != nil {
		t.Fatalf("existing sessions could not reconnect: %v", err)
	}
	claims = append(claims, map[string]interface{}{"sessionId": "extra", "resumeToken": strings.Repeat("ab", 32)})
	if err := sessions.register(queuedPeer(), identity, claims); err == nil {
		t.Fatal("accepted new resume claims above the limit")
	}
	if sessions.count(identity) != 5 {
		t.Fatal("failed registration changed existing sessions")
	}
}
