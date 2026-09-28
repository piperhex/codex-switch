package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func (s *service) bandwidth(c *gin.Context) {
	if s.deps.ReadBandwidth == nil {
		platform.Fail(c, 503, "Bandwidth monitoring is unavailable")
		return
	}
	platform.Respond(c, s.deps.ReadBandwidth(), nil)
}
