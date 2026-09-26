package mediarelay

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"
)

// Certificates can follow an existing private certificate manager without creating another renewal job.
type certificates struct {
	config  Config
	current atomic.Pointer[tls.Certificate]
}

func (c *certificates) refresh(ctx context.Context) error {
	var certificate tls.Certificate
	var err error
	if c.config.TLSCertURL == "" {
		certificate, err = tls.LoadX509KeyPair(c.config.TLSCert, c.config.TLSKey)
	}
	if c.config.TLSCertURL != "" {
		certificate, err = c.fetch(ctx)
	}
	if err != nil {
		return err
	}
	c.current.Store(&certificate)
	return nil
}

func (c *certificates) fetch(ctx context.Context) (tls.Certificate, error) {
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.config.TLSCertURL, nil)
	if err != nil {
		return tls.Certificate{}, err
	}
	// This is a trusted, server-configured private endpoint, independent of user outbound proxy settings.
	client := &http.Client{Transport: &http.Transport{}, Timeout: connectTimeout}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return tls.Certificate{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return tls.Certificate{}, fmt.Errorf("certificate service unavailable")
	}
	var value struct {
		Cert string `json:"cert"`
		Key  string `json:"key"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&value); err != nil {
		return tls.Certificate{}, err
	}
	return tls.X509KeyPair([]byte(value.Cert), []byte(value.Key))
}

func (c *certificates) get(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	return c.current.Load(), nil
}

func (p *Proxy) refreshCertificates(cache *certificates) {
	defer p.workers.Done()
	timer := time.NewTicker(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-p.context.Done():
			return
		case <-timer.C:
			if err := cache.refresh(p.context); err != nil {
				// Retain the last valid certificate. Never log a response containing a private key.
				slog.Warn("media relay certificate refresh failed; retaining previous certificate")
			}
		}
	}
}
