package devices

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestClientDiagnosticsSanitizeAndBoundReports(t *testing.T) {
	d, buffer := diagnosticFixture()
	input := platform.JSON{"event": "ice-summary", "scope": "desktop", "requestsSent": float64(622),
		"responsesReceived": float64(0), "bytesSent": math.Inf(1), "reason": "private-error",
		"session": "private-session", "role": "private-role", "candidate": "private-address", "secret": "private-secret"}
	for range clientDiagnosticLimit + 10 {
		d.clientEvent("session", input)
	}
	output := buffer.String()
	if strings.Contains(output, "private-") || strings.Contains(output, "bytesSent") ||
		strings.Count(output, "connection diagnostic") != clientDiagnosticLimit ||
		!strings.Contains(output, `"requestsSent":622`) || !strings.Contains(output, `"responsesReceived":0`) {
		t.Fatalf("unsafe or incomplete diagnostics: %s", output)
	}
	d.clientWindow = time.Now().Add(-time.Minute)
	d.clientEvent("session", input)
	if !strings.Contains(buffer.String(), `"suppressed":10`) {
		t.Fatal("missing throttled-event count")
	}
	d.clientEvent("session", platform.JSON{"event": "private-event"})
	if strings.Contains(buffer.String(), "private-") {
		t.Fatal("unknown event was logged")
	}
}

func TestIceDiagnosticsRetainEveryGeneration(t *testing.T) {
	d, buffer := diagnosticFixture()
	for _, generation := range []float64{0, 1, 1, 2} {
		d.queued(platform.JSON{"type": "signal", "sessionId": "session", "payload": platform.JSON{
			"kind": "ice", "generation": generation, "candidate": "candidate:1 1 udp 1 192.0.2.1 1000 typ srflx"}})
	}
	if strings.Count(buffer.String(), "candidate_type") != 3 {
		t.Fatal("a later ICE generation was hidden by candidate deduplication")
	}
	d.queued(platform.JSON{"type": "signal", "sessionId": "empty", "payload": platform.JSON{"kind": "ice"}})
}

func TestClientDiagnosticsRequireSessionMembershipAndDoNotForward(t *testing.T) {
	sessions := newHotSessions(nil)
	desktop, mobile, outsider := queuedPeer(), queuedPeer(), queuedPeer()
	diagnostic, buffer := diagnosticFixture()
	mobile.diagnostics = diagnostic
	sessions.sessions["session"] = &hotSession{id: "session", expires: time.Now().Add(time.Minute),
		desktop: chatEndpoint{socket: desktop}, mobile: &chatEndpoint{socket: mobile}}
	frame := platform.JSON{"type": "diagnostic", "sessionId": "session",
		"payload": platform.JSON{"event": "ice-state", "state": "failed", "scope": "chat"}}
	if handled, err := sessions.route(outsider, frame); !handled || err == nil {
		t.Fatal("accepted diagnostic for another client's session")
	}
	if handled, err := sessions.route(mobile, frame); !handled || err != nil {
		t.Fatal("rejected authenticated diagnostic", err)
	}
	if !strings.Contains(buffer.String(), "connection diagnostic") || len(desktop.queue) != 0 {
		t.Fatal("diagnostic must stay in server logs and never be sent to the peer")
	}
}

func TestClientDiagnosticsDoNotConsumeRelayBudget(t *testing.T) {
	gateway := &ChatGateway{sessions: newChatSessions(nil), policy: platform.JSON{
		"relayMaxFramesPerSecond": float64(1), "relayMaxMbPerSecond": float64(1)}}
	desktop, mobile := queuedPeer(), queuedPeer()
	diagnostic, buffer := diagnosticFixture()
	mobile.diagnostics = diagnostic
	expires := time.Now().Add(time.Minute)
	gateway.sessions.hot.sessions["session"] = &hotSession{id: "session", expires: expires,
		desktop: chatEndpoint{socket: desktop}, mobile: &chatEndpoint{socket: mobile}}
	state := &chatConnection{identity: &chatIdentity{expires: expires}, windowStart: time.Now()}
	frame := platform.JSON{"type": "diagnostic", "sessionId": "session",
		"payload": platform.JSON{"event": "ice-state", "state": "checking"}}
	for range 10 {
		if err := gateway.receive(mobile, state, frame, 100); err != nil {
			t.Fatal(err)
		}
	}
	if state.bytes != 0 || state.frames != 0 {
		t.Fatal("diagnostic used the application's relay budget")
	}
	before := buffer.Len()
	if err := gateway.receive(mobile, state, frame, maxClientDiagnosticBytes+1); err != nil || buffer.Len() != before {
		t.Fatal("oversized diagnostic must be dropped without closing the session")
	}
}
