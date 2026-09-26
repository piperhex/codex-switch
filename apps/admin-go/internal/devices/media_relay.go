package devices

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/mediarelay"
	"github.com/codex-switch/admin-go/internal/platform"
)

const desktopCredentialLifetime = time.Hour

func desktopTURNURLs(raw string) ([]string, error) {
	urls := []string{}
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "turn" && parsed.Scheme != "turns") || parsed.Fragment != "" {
			return nil, fmt.Errorf("invalid DESKTOP_TURN_URLS")
		}
		address := parsed.Opaque
		host, port, err := net.SplitHostPort(address)
		number, numberErr := strconv.Atoi(port)
		query, queryErr := url.ParseQuery(parsed.RawQuery)
		transport := query.Get("transport")
		if err != nil || numberErr != nil || queryErr != nil || host == "" || number < 1 || number > 65535 ||
			strings.ContainsAny(host, " /@?#\t\r\n") || len(query) > 1 ||
			(len(query) != 0 && len(query["transport"]) != 1) ||
			(transport != "" && transport != "udp" && transport != "tcp") ||
			(parsed.Scheme == "turns" && transport == "udp") {
			return nil, fmt.Errorf("invalid DESKTOP_TURN_URLS")
		}
		urls = append(urls, value)
	}
	return urls, nil
}

func (g *ChatGateway) startMediaRelay() error {
	config := g.service.deps.Config
	urls, err := desktopTURNURLs(config.Get("DESKTOP_TURN_URLS", ""))
	if err != nil || len(urls) == 0 {
		return err
	}
	relayConfig := mediarelay.Config{
		Listen:    config.Get("DESKTOP_TURN_LISTEN", "0.0.0.0:3479"),
		Backend:   config.Get("DESKTOP_TURN_BACKEND", ""),
		Realm:     config.Get("DESKTOP_TURN_REALM", "codex-switch"),
		Secret:    config.Get("DESKTOP_TURN_SECRET", ""),
		TLSListen: config.Get("DESKTOP_TURN_TLS_LISTEN", ""),
		TLSCert:   config.Get("DESKTOP_TURN_TLS_CERT", ""), TLSKey: config.Get("DESKTOP_TURN_TLS_KEY", ""),
		TLSCertURL: config.Get("DESKTOP_TURN_TLS_CERT_URL", ""),
	}
	for _, address := range urls {
		if strings.HasPrefix(address, "turns:") && relayConfig.TLSListen == "" {
			return fmt.Errorf("DESKTOP_TURN_URLS requires a TLS listener")
		}
	}
	g.media, err = mediarelay.Start(relayConfig, g.transmitMedia)
	if err != nil {
		return err
	}
	g.sessions.desktopICE = func(owner string, expires time.Time) []platform.JSON {
		if limit := time.Now().Add(desktopCredentialLifetime); expires.After(limit) {
			expires = limit
		}
		credential := mediarelay.Issue(relayConfig.Secret, owner, expires)
		servers := append([]platform.JSON(nil), g.ice...)
		return append(servers, platform.JSON{"urls": urls, "username": credential.Username,
			"credential": credential.Credential})
	}
	g.sessions.hot.desktopICE = g.sessions.desktopICE
	return nil
}

func (g *ChatGateway) transmitMedia(ctx context.Context, owner string, bytes int, write func() error) error {
	return g.meter.Transmit(ctx, owner, bytes, func() error {
		if err := write(); err != nil {
			return err
		}
		g.traffic.record(bytes)
		return nil
	})
}

// An open chat can outlive TURN credentials; refresh future desktop opens without interrupting active media.
func (g *ChatGateway) refreshDesktopICE() {
	if g.sessions.desktopICE == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for client, connection := range g.connections {
		identity := connection.identity
		if identity == nil || identity.role != "desktop" || !identity.expires.After(time.Now()) {
			continue
		}
		client.send(platform.JSON{"type": "desktop-ice",
			"desktopIceServers": g.sessions.desktopICE(identity.owner, identity.expires)}, nil)
	}
}
