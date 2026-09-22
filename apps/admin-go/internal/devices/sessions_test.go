package devices

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func queuedPeer() *peer {
	return &peer{queue: make(chan outputFrame, 32), done: make(chan struct{})}
}

func TestReconstructedHotSessionPreservesProofAndOwnership(t *testing.T) {
	sessions := newHotSessions(nil)
	identity := chatIdentity{owner: "owner", device: "device", role: "desktop", expires: time.Now().Add(time.Minute)}
	proof := strings.Repeat("ab", 32)
	descriptors := []interface{}{map[string]interface{}{"sessionId": "restored", "resumeToken": proof}}
	desktop := queuedPeer()
	if err := sessions.register(desktop, identity, descriptors); err != nil {
		t.Fatal(err)
	}
	if sessions.count(identity) != 1 || sessions.sessions["restored"].mobile != nil {
		t.Fatal("desktop descriptor did not reconstruct an offline session")
	}
	for _, claim := range []resumeClaim{{"restored", strings.Repeat("cd", 32)}, {"restored", proof}} {
		attempt := identity
		if claim.token == proof {
			attempt.owner = "another-owner"
		}
		if sessions.validateClaim(claim, attempt) == nil {
			t.Fatal("invalid proof or owner was accepted")
		}
	}
	if err := sessions.register(queuedPeer(), identity, nil); err != nil {
		t.Fatal(err)
	}
	if sessions.count(identity) != 0 || sessions.validateClaim(resumeClaim{"restored", proof}, identity) == nil {
		t.Fatal("omitted descriptor did not revoke its old proof")
	}
	handled, err := sessions.route(desktop, platform.JSON{"sessionId": "restored", "type": "relay"})
	if !handled || err != nil {
		t.Fatal("closed session did not absorb an in-flight frame", err)
	}
}

func TestExpiredHotSessionIsRevokedBeforeResume(t *testing.T) {
	sessions := newHotSessions(nil)
	identity := chatIdentity{owner: "owner", device: "device", role: "desktop", expires: time.Now().Add(-time.Second)}
	proof := strings.Repeat("ab", 32)
	if err := sessions.register(queuedPeer(), identity,
		[]interface{}{map[string]interface{}{"sessionId": "expired", "resumeToken": proof}}); err != nil {
		t.Fatal(err)
	}
	sessions.prune()
	if sessions.count(identity) != 0 || sessions.validateClaim(resumeClaim{"expired", proof}, identity) == nil {
		t.Fatal("expired session remains resumable")
	}
}

func TestChatSessionsSerializeConcurrentLifecycle(t *testing.T) {
	sessions := newChatSessions(nil)
	var workers sync.WaitGroup
	for index := range 24 {
		workers.Go(func() {
			identity := chatIdentity{owner: fmt.Sprint(index), device: "device", role: "desktop",
				expires: time.Now().Add(time.Minute)}
			desktop, mobile := queuedPeer(), queuedPeer()
			if err := sessions.join(desktop, identity, platform.JSON{"transportVersion": float64(2)}, nil); err != nil {
				t.Error(err)
				return
			}
			identity.role = "mobile"
			message := platform.JSON{"transportVersion": float64(2), "publicKey": strings.Repeat("ab", 32)}
			if err := sessions.join(mobile, identity, message, nil); err != nil {
				t.Error(err)
				return
			}
			sessions.disconnect(mobile, false)
			sessions.prune()
			sessions.disconnect(desktop, true)
		})
	}
	workers.Wait()
	if len(sessions.hot.sessions) != 0 || len(sessions.sessions) != 0 || len(sessions.desktops) != 0 {
		t.Fatal("concurrent lifecycle leaked sessions or desktops")
	}
}
