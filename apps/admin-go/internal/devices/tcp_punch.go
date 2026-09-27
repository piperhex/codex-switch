package devices

import (
	"errors"
	"io"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

const tcpBindingLifetime = 20 * time.Second
const maxTCPBindings = 128

type tcpPunchServer struct {
	listener net.Listener
	mu       sync.Mutex
	clients  map[net.Conn]bool
	closed   bool
}

func tcpPunchConfig(config platform.Config) (platform.JSON, error) {
	servers := []platform.JSON{}
	for _, value := range strings.Split(config.Get("CHAT_TCP_URLS", ""), ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme != "tcp" || parsed.User != nil || parsed.RawQuery != "" ||
			parsed.Fragment != "" || parsed.Path != "" || parsed.Hostname() == "" {
			return nil, errors.New("invalid CHAT_TCP_URLS")
		}
		port, err := strconv.Atoi(parsed.Port())
		if err != nil || port < 1024 || port > 65535 || len(servers) >= 2 {
			return nil, errors.New("invalid CHAT_TCP_URLS")
		}
		servers = append(servers, platform.JSON{"host": parsed.Hostname(), "port": port})
	}
	if len(servers) == 0 {
		return nil, nil
	}
	return platform.JSON{"servers": servers}, nil
}

func (g *ChatGateway) startTCPPunch() error {
	config := g.service.deps.Config
	settings, err := tcpPunchConfig(config)
	if err != nil || settings == nil {
		return err
	}
	listener, err := net.Listen("tcp", config.Get("CHAT_TCP_LISTEN", "0.0.0.0:3478"))
	if err != nil {
		return err
	}
	g.tcp = &tcpPunchServer{listener: listener, clients: map[net.Conn]bool{}}
	g.sessions.hot.tcpConfig = settings
	go g.tcp.serve()
	return nil
}

func (server *tcpPunchServer) serve() {
	for {
		client, err := server.listener.Accept()
		if err != nil {
			return
		}
		server.mu.Lock()
		admitted := !server.closed && len(server.clients) < maxTCPBindings
		if admitted {
			server.clients[client] = true
		}
		server.mu.Unlock()
		if !admitted {
			closeTCPBinding(client)
			continue
		}
		go server.bind(client)
	}
}

func (server *tcpPunchServer) bind(client net.Conn) {
	defer func() {
		closeTCPBinding(client)
		server.mu.Lock()
		delete(server.clients, client)
		server.mu.Unlock()
	}()
	if client.SetDeadline(time.Now().Add(tcpBindingLifetime)) != nil {
		return
	}
	request := make([]byte, stunHeaderBytes)
	if _, err := io.ReadFull(client, request); err != nil {
		return
	}
	remote, ok := client.RemoteAddr().(*net.TCPAddr)
	if !ok {
		return
	}
	response := bindingResponse(request, &net.UDPAddr{IP: remote.IP, Port: remote.Port})
	if response == nil {
		return
	}
	if _, err := client.Write(response); err != nil {
		return
	}
	// Retain the observed mapping while the peer dials. This listener never relays application traffic.
	one := make([]byte, 1)
	_, err := client.Read(one)
	if err != nil && !errors.Is(err, io.EOF) {
		if timeout, ok := err.(net.Error); !ok || !timeout.Timeout() {
			slog.Debug("TCP binding closed", "error", err)
		}
	}
}

func closeTCPBinding(client net.Conn) {
	if err := client.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		slog.Debug("TCP binding cleanup", "error", err)
	}
}

func (server *tcpPunchServer) close() {
	if server == nil {
		return
	}
	if err := server.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
		slog.Debug("TCP discovery stopped", "error", err)
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	server.closed = true
	for client := range server.clients {
		closeTCPBinding(client)
	}
}

func validTCPAddress(value interface{}) bool {
	address, ok := value.(map[string]interface{})
	if !ok {
		return false
	}
	host, ok := address["host"].(string)
	if !ok {
		return false
	}
	ip := net.ParseIP(host)
	port, ok := address["port"].(float64)
	return allowedPeerIP(ip) && ok &&
		port >= 1024 && port <= 65535 && port == float64(int(port))
}

func allowedPeerIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		return v4[0] > 0 && v4[0] < 224
	}
	return ip[0]&0xe0 == 0x20 || ip[0]&0xfe == 0xfc
}

func validTCPSignal(message platform.JSON) bool {
	if _, err := publicKey(message["publicKey"]); err != nil {
		return false
	}
	addresses, ok := message["addresses"].([]interface{})
	if !ok || len(addresses) > 6 {
		return false
	}
	for _, address := range addresses {
		if !validTCPAddress(address) {
			return false
		}
	}
	return true
}
