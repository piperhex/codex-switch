package devices

import (
	"encoding/binary"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestTCPDiscoveryReportsTheObservedSocket(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &tcpPunchServer{listener: listener, clients: map[net.Conn]bool{}}
	go server.serve()
	t.Cleanup(server.close)
	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.SetDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	request := make([]byte, 20)
	binary.BigEndian.PutUint16(request, 1)
	binary.BigEndian.PutUint32(request[4:], stunCookie)
	copy(request[8:], "transaction1")
	// Fragment the STUN request over TCP; the service must wait for its entire header.
	if _, err := client.Write(request[:7]); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Write(request[7:]); err != nil {
		t.Fatal(err)
	}
	response := make([]byte, 32)
	if _, err := io.ReadFull(client, response); err != nil {
		t.Fatal(err)
	}
	port := binary.BigEndian.Uint16(response[26:]) ^ uint16(stunCookie>>16)
	if int(port) != client.LocalAddr().(*net.TCPAddr).Port {
		t.Fatal("wrong observed source port")
	}
	if string(response[8:20]) != string(request[8:20]) {
		t.Fatal("wrong transaction")
	}
}

func TestTCPCandidatesValidateDestinations(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "::1", "169.254.1.1", "fe80::1", "224.0.0.1", "example.com"} {
		if validTCPAddress(platform.JSON{"host": host, "port": float64(45000)}) {
			t.Fatalf("accepted %s", host)
		}
	}
	for _, host := range []string{"192.168.1.5", "2001:db8::1", "fd00::5"} {
		if !validTCPAddress(platform.JSON{"host": host, "port": float64(45000)}) {
			t.Fatalf("rejected %s", host)
		}
	}
	if validTCPAddress(platform.JSON{"host": "192.168.1.5", "port": float64(80)}) {
		t.Fatal("privileged port")
	}
}

func TestTCPPathsRequireBothEndpointCapabilities(t *testing.T) {
	for _, capabilities := range [][3]bool{{false, true, true}, {true, false, true}, {true, true, false}, {true, true, true}} {
		enabled := capabilities[0] && capabilities[1] && capabilities[2]
		sessions := newChatSessions(nil)
		if capabilities[2] {
			sessions.hot.tcpConfig = platform.JSON{"servers": []platform.JSON{{"host": "punch.example", "port": 3478}}}
		}
		desktop, mobile := queuedPeer(), queuedPeer()
		identity := chatIdentity{owner: "owner", device: "pc", role: "desktop", expires: time.Now().Add(time.Minute)}
		if err := sessions.join(desktop, identity, platform.JSON{
			"transportVersion": float64(2), "tcpPunch": capabilities[0]}, nil); err != nil {
			t.Fatal(err)
		}
		updateFrame(t, desktop)
		identity.role = "mobile"
		if err := sessions.join(mobile, identity, platform.JSON{"transportVersion": float64(2), "tcpPunch": capabilities[1],
			"publicKey": strings.Repeat("ab", 32)}, nil); err != nil {
			t.Fatal(err)
		}
		opened, paired := updateFrame(t, desktop), updateFrame(t, mobile)
		if (opened["tcpPunch"] != nil) != enabled || (paired["tcpPunch"] != nil) != enabled {
			t.Fatal("capability negotiation differs between endpoints")
		}
		frame := platform.JSON{"type": "signal", "sessionId": paired["sessionId"], "payload": platform.JSON{
			"kind": "tcp", "publicKey": strings.Repeat("cd", 32), "addresses": []interface{}{}}}
		if err := sessions.route(mobile, frame); (err == nil) != enabled {
			t.Fatal("unnegotiated TCP signal")
		}
	}
}
