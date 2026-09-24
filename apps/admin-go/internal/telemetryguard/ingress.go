package telemetryguard

import (
	"io"
	"net/http"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

const maxBodyBytes = 4096

// Ingress runs before body decoding and contract validation to bound invalid traffic too.
func (g *Guard) Ingress() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost || c.FullPath() != "/telemetry/installations" {
			c.Next()
			return
		}
		err := g.check(c.Request.Context(), []budget{
			{"GLOBAL_REQUESTS_PER_MINUTE", "all"},
			{"SOURCE_REQUESTS_PER_MINUTE", Source(c)},
		})
		if err != nil {
			Respond(c, err)
			return
		}
		if !boundedBody(c) {
			return
		}
		c.Next()
	}
}

func boundedBody(c *gin.Context) bool {
	// Official clients send tiny, uncompressed payloads. Reject compression before decoding.
	encoding := strings.TrimSpace(c.GetHeader("Content-Encoding"))
	if encoding != "" && !strings.EqualFold(encoding, "identity") {
		platform.Fail(c, 415, "Unsupported content encoding")
		return false
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBodyBytes+1))
	if err != nil {
		platform.Fail(c, 400, "Bad Request")
		return false
	}
	if len(body) > maxBodyBytes {
		platform.Fail(c, 413, "Payload Too Large")
		return false
	}
	c.Request.Body = io.NopCloser(strings.NewReader(string(body)))
	return true
}
