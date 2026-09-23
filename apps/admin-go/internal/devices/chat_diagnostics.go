package devices

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const diagnosticEventsPerMinute = 60

// Connection metadata only. Payloads, credentials, SDP, IP addresses and user IDs never enter logs.
type chatDiagnostics struct {
	mu         sync.Mutex
	logger     *slog.Logger
	started    time.Time
	window     time.Time
	events     int
	suppressed int
	seen       map[string]bool
	frames     int
	bytes      int
	closed     bool
}

func newChatDiagnostics() *chatDiagnostics {
	now := time.Now()
	d := &chatDiagnostics{logger: slog.Default().With("connection", uuid.NewString()),
		started: now, window: now, seen: map[string]bool{}}
	d.logger.Info("chat connection opened")
	return d
}

func (d *chatDiagnostics) authenticated(identity chatIdentity, message platform.JSON) {
	d.mu.Lock()
	defer d.mu.Unlock()
	device := sha256.Sum256([]byte(identity.owner + ":" + identity.device))
	d.logger = d.logger.With("role", identity.role, "device", hex.EncodeToString(device[:8]))
	_, resuming := message["resume"]
	d.logger.Info("chat authenticated", "transport", desktopTransportVersion(message["transportVersion"]),
		"resuming", resuming)
}

func (d *chatDiagnostics) received(size int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.frames++
	d.bytes += size
}

func (d *chatDiagnostics) log(event string, fields ...interface{}) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.allow() {
		d.logger.Info(event, fields...)
	}
}

func (d *chatDiagnostics) allow() bool {
	if time.Since(d.window) >= time.Minute {
		d.window, d.events = time.Now(), 0
		clear(d.seen)
	}
	if d.events >= diagnosticEventsPerMinute {
		d.suppressed++
		return false
	}
	d.events++
	return true
}

func (d *chatDiagnostics) queued(value interface{}) {
	if d == nil {
		return
	}
	message, ok := value.(platform.JSON)
	if !ok {
		return
	}
	fields, key := diagnosticFrame(message)
	if fields == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if key != "" && d.seen[key] {
		return
	}
	if !d.allow() {
		return
	}
	if key != "" {
		d.seen[key] = true
	}
	d.logger.Info("chat frame queued", fields...)
}

func (d *chatDiagnostics) close(code int, reason string) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		return
	}
	d.closed = true
	d.logger.Info("chat connection closed", "code", code, "reason", reason,
		"duration_ms", time.Since(d.started).Milliseconds(), "received_frames", d.frames,
		"received_bytes", d.bytes, "suppressed_events", d.suppressed)
}

func diagnosticFrame(message platform.JSON) ([]interface{}, string) {
	kind, _ := message["type"].(string)
	switch kind {
	case "registered", "paired", "peer-open", "resumed", "peer-offline", "peer-close", "relay-ready", "relay", "signal":
	default:
		return nil, ""
	}
	fields := []interface{}{"type", kind}
	id, err := identifier(message["sessionId"])
	if err == nil {
		fields = append(fields, "session", id)
	}
	if kind == "relay" {
		return fields, "relay:" + id
	}
	if kind != "signal" {
		return fields, ""
	}
	payload, ok := message["payload"].(platform.JSON)
	if !ok {
		return nil, ""
	}
	return diagnosticSignal(fields, id, payload)
}

func diagnosticSignal(fields []interface{}, id string, payload platform.JSON) ([]interface{}, string) {
	kind, _ := payload["kind"].(string)
	switch kind {
	case "key", "sdp", "ice":
	default:
		return nil, ""
	}
	fields = append(fields, "signal", kind)
	if generation, ok := payload["generation"]; ok && safeNonnegativeInteger(generation) {
		fields = append(fields, "generation", generation)
	}
	if kind == "sdp" && (payload["type"] == "offer" || payload["type"] == "answer") {
		fields = append(fields, "description", payload["type"])
	}
	if kind == "ice" {
		candidate, _ := payload["candidate"].(string)
		candidateType := diagnosticCandidateType(candidate)
		return append(fields, "candidate_type", candidateType), "ice:" + id + ":" + candidateType
	}
	return fields, ""
}

func diagnosticCandidateType(candidate string) string {
	parts := strings.Fields(candidate)
	for i := 0; i+1 < len(parts); i++ {
		if parts[i] == "typ" {
			switch parts[i+1] {
			case "host", "srflx", "prflx", "relay":
				return parts[i+1]
			}
		}
	}
	return "unknown"
}

// Only fixed protocol errors are safe to expose to operators; DB and token-parser errors may contain input.
func chatRejectionReason(err error) string {
	switch err.Error() {
	case "invalid authentication", "invalid role", "expired token", "invalid id", "invalid key",
		"invalid signal", "invalid generation", "rate exceeded", "invalid resume", "closed session",
		"invalid session proof", "invalid sessions", "duplicate sessions", "unknown session",
		"invalid relay", "invalid hot standby frame", "direct attempt still pending", "invalid chat frame":
		return err.Error()
	default:
		return "invalid request or authentication unavailable"
	}
}
