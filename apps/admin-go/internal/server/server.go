package server

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/codex-switch/admin-go/internal/accounts"
	"github.com/codex-switch/admin-go/internal/content"
	"github.com/codex-switch/admin-go/internal/devices"
	"github.com/codex-switch/admin-go/internal/identity"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/telemetryguard"
	"github.com/gin-gonic/gin"
)

func New(deps *platform.Dependencies) (*gin.Engine, *devices.Runtime, error) {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	if err := configureTrustedProxies(router, deps.Config); err != nil {
		return nil, nil, err
	}
	router.RedirectTrailingSlash = false
	router.UseRawPath = true
	guard, err := telemetryguard.New(deps)
	if err != nil {
		return nil, nil, err
	}
	router.Use(transportHeaders(), recovery(), guard.Ingress(), platform.RequestBodyParser(), cors())
	contract, err := platform.LoadContract()
	if err != nil {
		return nil, nil, err
	}
	router.Use(contract.Middleware(deps))
	registrations := []func(*gin.Engine, *platform.Dependencies) error{
		identity.Register, accounts.Register, content.Register,
	}
	for _, register := range registrations {
		if err := register(router, deps); err != nil {
			return nil, nil, err
		}
	}
	runtime, err := devices.Register(router, deps)
	if err != nil {
		return nil, nil, err
	}
	staticRoutes(router, deps.Config.Get("PUBLIC_DIR", "public"))
	if err := checkRoutes(router, contract); err != nil {
		runtime.Close()
		return nil, nil, err
	}
	return router, runtime, nil
}

func checkRoutes(router *gin.Engine, contract *platform.Contract) error {
	implemented := map[string]bool{}
	for _, route := range router.Routes() {
		implemented[route.Method+" "+route.Path] = true
	}
	missing := []string{}
	for _, route := range contract.Routes {
		if !implemented[route.Method+" "+route.Path] {
			missing = append(missing, route.Method+" "+route.Path)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("unimplemented legacy routes: %s", strings.Join(missing, ", "))
	}
	return nil
}

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Vary", "Origin")
		if origin := c.GetHeader("Origin"); origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == http.MethodOptions {
			c.Header("Content-Length", "0")
			c.Header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
			c.Header("Access-Control-Allow-Headers", c.GetHeader("Access-Control-Request-Headers"))
			c.Header("Vary", "Origin, Access-Control-Request-Headers")
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func recovery() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		c.AbortWithStatusJSON(500, gin.H{"statusCode": 500, "message": "Internal server error"})
	})
}
