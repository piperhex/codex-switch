package devices

import (
	"encoding/binary"
	"fmt"
	"log/slog"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

const stunCookie uint32 = 0x2112a442
const stunHeaderBytes = 20
const maxSTUNPacket = 1200

func bindingResponse(request []byte, remote *net.UDPAddr) []byte {
	if len(request) < stunHeaderBytes || len(request) > maxSTUNPacket || remote.IP.To4() == nil {
		return nil
	}
	length := int(binary.BigEndian.Uint16(request[2:4]))
	if binary.BigEndian.Uint16(request[:2]) != 1 || binary.BigEndian.Uint32(request[4:8]) != stunCookie ||
		length%4 != 0 || length != len(request)-stunHeaderBytes {
		return nil
	}
	response := make([]byte, 32)
	binary.BigEndian.PutUint16(response[:2], 0x0101)
	binary.BigEndian.PutUint16(response[2:4], 12)
	binary.BigEndian.PutUint32(response[4:8], stunCookie)
	copy(response[8:20], request[8:20])
	binary.BigEndian.PutUint16(response[20:22], 0x0020)
	binary.BigEndian.PutUint16(response[22:24], 8)
	response[25] = 1
	binary.BigEndian.PutUint16(response[26:28], uint16(remote.Port)^uint16(stunCookie>>16))
	for index, octet := range remote.IP.To4() {
		response[28+index] = octet ^ response[4+index]
	}
	return response
}

var stunURLPattern = regexp.MustCompile(`^stuns?:[^\s/?#@]+(?::\d+)?$`)

func iceServers(config platform.Config) ([]platform.JSON, error) {
	urls := []string{}
	for _, raw := range strings.Split(config.Get("CHAT_STUN_URLS", ""), ",") {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if !stunURLPattern.MatchString(value) {
			return nil, fmt.Errorf("invalid CHAT_STUN_URLS")
		}
		urls = append(urls, value)
	}
	servers := []platform.JSON{}
	if len(urls) > 0 {
		servers = append(servers, platform.JSON{"urls": urls})
	}
	return servers, nil
}

type stunServer struct{ conn *net.UDPConn }

func startSTUN(config platform.Config) (*stunServer, error) {
	port, err := strconv.Atoi(config.Get("CHAT_STUN_PORT", "3478"))
	if err != nil || (port != 0 && (port < 1024 || port > 65535)) {
		return nil, fmt.Errorf("invalid CHAT_STUN_PORT")
	}
	if port == 0 {
		return nil, nil
	}
	address, err := net.ResolveUDPAddr(
		"udp4",
		net.JoinHostPort(config.Get("CHAT_STUN_BIND", "0.0.0.0"), strconv.Itoa(port)),
	)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", address)
	if err != nil {
		slog.Error("chat STUN unavailable", "error", err)
		return nil, nil
	}
	server := &stunServer{conn}
	go server.listen()
	return server, nil
}

func (server *stunServer) listen() {
	buffer := make([]byte, 65535)
	window, packets := time.Now(), 0
	for {
		length, remote, err := server.conn.ReadFromUDP(buffer)
		if err != nil {
			return
		}
		if time.Since(window) >= time.Second {
			window, packets = time.Now(), 0
		}
		packets++
		if packets > 1000 {
			continue
		}
		response := bindingResponse(buffer[:length], remote)
		if response == nil {
			continue
		}
		if _, err := server.conn.WriteToUDP(response, remote); err != nil {
			slog.Debug("chat STUN response failed", "error", err)
		}
	}
}

func (server *stunServer) close() {
	if err := server.conn.Close(); err != nil {
		slog.Debug("chat STUN close", "error", err)
	}
}
