package devices

import (
	"bytes"
	"encoding/binary"
	"net"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestSTUNBindingAndMalformedPackets(t *testing.T) {
	request := make([]byte, 20)
	binary.BigEndian.PutUint16(request, 1)
	binary.BigEndian.PutUint32(request[4:8], stunCookie)
	copy(request[8:], []byte("test-trans12"))
	remote := &net.UDPAddr{IP: net.ParseIP("192.0.2.1"), Port: 54321}
	response := bindingResponse(request, remote)
	if len(response) != 32 || !bytes.Equal(response[8:20], request[8:20]) {
		t.Fatalf("invalid response %x", response)
	}
	if binary.BigEndian.Uint16(response[26:28])^uint16(stunCookie>>16) != 54321 {
		t.Fatal("incorrect XOR port")
	}
	for index, octet := range remote.IP.To4() {
		if response[28+index]^response[4+index] != octet {
			t.Fatal("incorrect XOR address")
		}
	}
	for _, invalid := range [][]byte{nil, request[:19], append(request, 0), make([]byte, 1201)} {
		if bindingResponse(invalid, remote) != nil {
			t.Fatal("accepted malformed STUN datagram")
		}
	}
	if bindingResponse(request, &net.UDPAddr{IP: net.ParseIP("::1"), Port: 1}) != nil {
		t.Fatal("accepted unsupported IPv6")
	}
}

func TestSignalsDoNotForwardKeyMetadata(t *testing.T) {
	key := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	signal, err := chatSignal(platform.JSON{"kind": "key", "key": key, "generation": float64(4), "extra": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(signal, platform.JSON{"kind": "key", "key": key}) {
		t.Fatalf("unexpected signal %#v", signal)
	}
	for _, invalid := range []platform.JSON{
		{"kind": "key", "key": key, "generation": float64(-1)},
		{"kind": "sdp", "type": "unknown", "sdp": "x"},
		{"kind": "ice", "candidate": "x"},
	} {
		if _, err := chatSignal(invalid); err == nil {
			t.Fatalf("accepted invalid signal %#v", invalid)
		}
	}
	emptyCandidate := platform.JSON{"kind": "ice", "candidate": "", "sdpMid": nil, "sdpMLineIndex": nil}
	if _, err := chatSignal(emptyCandidate); err != nil {
		t.Fatal(err)
	}
}

func TestRelayRateWindowAndUnlimitedPolicy(t *testing.T) {
	gateway := &ChatGateway{
		policy: platform.JSON{"relayMaxMbPerSecond": float64(-1), "relayMaxFramesPerSecond": float64(2)},
	}
	state := &chatConnection{windowStart: time.Now()}
	if gateway.checkRate(state, 20) != nil || gateway.checkRate(state, 20) != nil {
		t.Fatal("rejected allowed frames")
	}
	if gateway.checkRate(state, 20) == nil {
		t.Fatal("accepted frame beyond limit")
	}
	state.windowStart = time.Now().Add(-time.Second)
	if err := gateway.checkRate(state, 20); err != nil {
		t.Fatal("window did not reset")
	}
	gateway.policy["relayMaxFramesPerSecond"] = float64(-1)
	if err := gateway.checkRate(state, 20*1024*1024); err != nil {
		t.Fatal("unlimited policy rejected bytes")
	}
}

func TestDeviceCapabilitiesWhitelistAndOrder(t *testing.T) {
	actual := normalizeCapabilities([]interface{}{"restart-codex", "bad", "provider-switch", "restart-codex", 42})
	if !reflect.DeepEqual(actual, []string{"restart-codex", "provider-switch"}) {
		t.Fatal(actual)
	}
}

func TestSignalLengthsUseJavaScriptUTF16Units(t *testing.T) {
	if _, err := chatSignal(platform.JSON{"kind": "sdp", "type": "offer", "sdp": strings.Repeat("中", 10000)}); err != nil {
		t.Fatal("valid multibyte SDP rejected", err)
	}
	candidate := platform.JSON{"kind": "ice", "candidate": strings.Repeat("😀", 1024), "sdpMid": nil, "sdpMLineIndex": nil}
	if _, err := chatSignal(candidate); err != nil {
		t.Fatal("valid UTF16-sized candidate rejected", err)
	}
	candidate["candidate"] = strings.Repeat("😀", 1025)
	if _, err := chatSignal(candidate); err == nil {
		t.Fatal("oversized UTF16 candidate accepted")
	}
}

func TestDesktopVersionCoercionPreservesLegacyStringVersion(t *testing.T) {
	for _, input := range []interface{}{float64(2), "2", " 2.0 ", []interface{}{"2"}} {
		if desktopTransportVersion(input) != 2 {
			t.Fatalf("unsupported version %#v", input)
		}
	}
}
