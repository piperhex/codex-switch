package devices

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func diagnosticFixture() (*chatDiagnostics, *bytes.Buffer) {
	buffer := &bytes.Buffer{}
	return &chatDiagnostics{logger: slog.New(slog.NewJSONHandler(buffer, nil)),
		started: time.Now(), window: time.Now(), seen: map[string]bool{}}, buffer
}

func TestChatDiagnosticsExcludePayloadsAndCredentials(t *testing.T) {
	d, buffer := diagnosticFixture()
	d.authenticated(chatIdentity{owner: "private-owner", device: "private-device", role: "mobile"},
		platform.JSON{"transportVersion": float64(2), "accessToken": "private-access"})
	for _, frame := range []platform.JSON{
		{"type": "paired", "sessionId": "session", "resumeToken": "private-resume"},
		{"type": "signal", "sessionId": "session", "payload": platform.JSON{"kind": "key", "key": "private-key"}},
		{"type": "signal", "sessionId": "session", "payload": platform.JSON{
			"kind": "sdp", "type": "offer", "sdp": "private-sdp", "generation": float64(3)}},
		{"type": "signal", "sessionId": "session", "payload": platform.JSON{
			"kind": "ice", "candidate": "candidate:1 1 udp 1 private-address 1234 typ srflx"}},
		{"type": "relay", "sessionId": "session", "payload": "private-message"},
		{"type": "private-unknown", "sessionId": "private-session"},
	} {
		d.queued(frame)
	}
	output := buffer.String()
	if strings.Contains(output, "private-") {
		t.Fatalf("sensitive data in diagnostics: %s", output)
	}
	for _, expected := range []string{`"description":"offer"`, `"generation":3`, `"candidate_type":"srflx"`} {
		if !strings.Contains(output, expected) {
			t.Fatalf("missing %s from diagnostics", expected)
		}
	}
}

func TestChatDiagnosticsBoundConcurrentTrafficAndLogClosureOnce(t *testing.T) {
	d, buffer := diagnosticFixture()
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			for range 100 {
				d.received(10)
				d.queued(platform.JSON{"type": "relay", "sessionId": "session"})
				d.queued(platform.JSON{"type": "resumed", "sessionId": "session"})
			}
		})
	}
	workers.Wait()
	d.close(4001, "Chat connection rejected")
	d.close(1006, "transport closed")
	output := buffer.String()
	if strings.Count(output, "chat frame queued") != diagnosticEventsPerMinute ||
		strings.Count(output, `"type":"relay"`) != 1 || strings.Count(output, "chat connection closed") != 1 ||
		!strings.Contains(output, `"received_frames":800`) {
		t.Fatalf("unbounded or incomplete diagnostics: %s", output)
	}
	d.window = time.Now().Add(-2 * time.Minute)
	d.log("new window")
	if !strings.Contains(buffer.String(), "new window") {
		t.Fatal("logging did not recover after rate limit window")
	}
}

func TestChatRejectionReasonsAreSanitized(t *testing.T) {
	if chatRejectionReason(errors.New("invalid signal")) != "invalid signal" {
		t.Fatal("lost useful rejection reason")
	}
	if strings.Contains(chatRejectionReason(errors.New("SQL contains private-token")), "private-token") {
		t.Fatal("untrusted internal error leaked")
	}
}
