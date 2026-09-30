package devices

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
)

func nativeTraversalConfig(config platform.Config) (platform.JSON, error) {
	servers := splitTraversalServers(config.Get("CHAT_NATIVE_PEERS", ""))
	if len(servers) == 0 {
		return nil, nil
	}
	stun := splitTraversalServers(config.Get("CHAT_NATIVE_STUN", ""))
	if len(servers) > 4 || len(stun) < 2 || len(stun) > 8 {
		return nil, errors.New("invalid native traversal servers")
	}
	for _, server := range servers {
		parsed, err := url.Parse(server)
		if err != nil || (parsed.Scheme != "tcp" && parsed.Scheme != "udp") || parsed.User != nil ||
			parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || !validTraversalHost(parsed.Host) {
			return nil, errors.New("invalid CHAT_NATIVE_PEERS")
		}
	}
	for _, server := range stun {
		if !validTraversalHost(server) {
			return nil, errors.New("invalid CHAT_NATIVE_STUN")
		}
	}
	return platform.JSON{"servers": servers, "stunServers": stun}, nil
}

func splitTraversalServers(value string) []string {
	values := []string{}
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			values = append(values, part)
		}
	}
	return values
}

func validTraversalHost(address string) bool {
	host, rawPort, err := net.SplitHostPort(address)
	port, portErr := strconv.Atoi(rawPort)
	return err == nil && host != "" && len(host) <= 253 && !strings.ContainsAny(host, "/?#@ \t\r\n") &&
		portErr == nil && port >= 1024 && port <= 65535
}

// Per-session isolation also survives authenticated signaling reconnections without changing the engine identity.
func (s *hotSessions) nativeTraversal(session *hotSession) platform.JSON {
	if !session.native || s.nativeConfig == nil {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(session.token))
	mac.Write([]byte("csw-native-traversal-v1:" + session.id))
	return platform.JSON{"secret": hex.EncodeToString(mac.Sum(nil)),
		"expiresAt": session.expires.UnixMilli(),
		"servers":   s.nativeConfig["servers"], "stunServers": s.nativeConfig["stunServers"]}
}
