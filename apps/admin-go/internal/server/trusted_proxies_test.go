package server

import (
	"net/http/httptest"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func TestTrustedProxyUsesNearestUntrustedSource(t *testing.T) {
	router := gin.New()
	if err := configureTrustedProxies(router, platform.Config{
		"TRUSTED_PROXY_CIDRS": "192.0.2.10/32",
	}); err != nil {
		t.Fatal(err)
	}
	router.GET("/", func(c *gin.Context) { c.String(200, c.ClientIP()) })
	for _, test := range []struct{ peer, forwarded, expected string }{
		{"192.0.2.10:1234", "198.51.100.99, 198.51.100.2", "198.51.100.2"},
		{"198.51.100.3:1234", "198.51.100.99", "198.51.100.3"},
		{"192.0.2.10:1234", "invalid", "192.0.2.10"},
	} {
		request := httptest.NewRequest("GET", "/", nil)
		request.RemoteAddr = test.peer
		request.Header.Set("X-Forwarded-For", test.forwarded)
		request.Header.Set("X-Real-IP", "198.51.100.99")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Body.String() != test.expected {
			t.Fatalf("%+v: %s", test, response.Body)
		}
	}
}

func TestTrustedProxiesRejectTrustAllAndInvalidValues(t *testing.T) {
	for _, value := range []string{"0.0.0.0/0", "::/0", "192.0.2.1", "invalid"} {
		if err := configureTrustedProxies(gin.New(), platform.Config{"TRUSTED_PROXY_CIDRS": value}); err == nil {
			t.Fatalf("accepted unsafe proxy configuration %q", value)
		}
	}
}
