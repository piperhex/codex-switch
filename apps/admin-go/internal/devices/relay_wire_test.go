package devices

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gorilla/websocket"
)

func TestBinaryRelayRoundTripAndNegotiation(t *testing.T) {
	frame := platform.JSON{"type": "relay", "sessionId": "session-1", "payload": "00abff"}
	wire, ok := encodeRelay(frame)
	if !ok || !bytes.Equal(wire, []byte("CSB1\x09session-1\x00\xab\xff")) {
		t.Fatalf("%x", wire)
	}
	client := &peer{}
	if _, err := readChatFrame(client, websocket.BinaryMessage, wire); err == nil {
		t.Fatal("unnegotiated binary")
	}
	client.binaryRelay.Store(true)
	decoded, err := readChatFrame(client, websocket.BinaryMessage, wire)
	if err != nil || decoded["payload"] != frame["payload"] || decoded["sessionId"] != frame["sessionId"] {
		t.Fatalf("%v %v", decoded, err)
	}
	frame["payload"] = strings.Repeat("ab", 10000)
	wire, ok = encodeRelay(frame)
	if !ok || len(wire) != 10000+relayHeaderBytes+len("session-1") {
		t.Fatal("ciphertext not binary")
	}
}

func TestBinarySocketAccountsActualWireBytes(t *testing.T) {
	charged := make(chan int, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		client := newPeer(conn)
		defer client.terminate()
		completed := make(chan struct{})
		client.binaryRelay.Store(true)
		client.sendGuarded(platform.JSON{"type": "relay", "sessionId": "id", "payload": strings.Repeat("ab", 1000)},
			func(n int) { charged <- n; close(completed) }, func(_ int, write func() error) error { return write() })
		select {
		case <-completed:
		case <-client.done:
		}
	}))
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err = conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	kind, data, err := conn.ReadMessage()
	if err != nil || kind != websocket.BinaryMessage || len(data) != 1007 {
		t.Fatalf("%d %d %v", kind, len(data), err)
	}
	if count := <-charged; count != len(data) {
		t.Fatalf("charged %d, sent %d", count, len(data))
	}
}

func TestBinaryRelayRejectsMalformedEnvelopes(t *testing.T) {
	for _, wire := range [][]byte{nil, []byte("CSB1\xffx"), []byte("CSB1\x00x"), []byte("CSB1\x01/hello")} {
		if _, err := decodeRelay(wire); err == nil {
			t.Fatalf("accepted %x", wire)
		}
	}
}
