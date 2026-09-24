package server

import (
	"fmt"
	"net/netip"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func configureTrustedProxies(router *gin.Engine, config platform.Config) error {
	var proxies []string
	for _, value := range strings.Split(config.Get("TRUSTED_PROXY_CIDRS", ""), ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil || prefix.Bits() == 0 {
			return fmt.Errorf("TRUSTED_PROXY_CIDRS must contain explicit proxy CIDRs, excluding /0")
		}
		proxies = append(proxies, value)
	}
	// Only the trusted ingress may contribute X-Forwarded-For; direct callers cannot spoof it.
	router.RemoteIPHeaders = []string{"X-Forwarded-For"}
	return router.SetTrustedProxies(proxies)
}
