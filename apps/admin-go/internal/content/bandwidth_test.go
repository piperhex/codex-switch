package content

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/codex-switch/admin-go/internal/bandwidth"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func TestBandwidthRequiresDashboardPermission(t *testing.T) {
	for _, test := range []struct {
		name      string
		principal *platform.Principal
		status    int
	}{
		{"anonymous", nil, http.StatusUnauthorized},
		{"wrong permission", &platform.Principal{Permissions: []string{"admin.telemetry.read"}}, http.StatusForbidden},
		{"dashboard reader", &platform.Principal{Permissions: []string{"admin.dashboard.read"}}, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			monitor := bandwidth.New()
			monitor.Record(2048)
			deps := &platform.Dependencies{ReadBandwidth: monitor.Snapshot,
				Authenticate: func(*gin.Context) (*platform.Principal, error) { return test.principal, nil }}
			router := gin.New()
			(&service{deps: deps}).analyticsRoutes(router)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/admin/api/dashboard/bandwidth", nil))
			if response.Code != test.status {
				t.Fatalf("status %d, body %s", response.Code, response.Body)
			}
			if test.status != http.StatusOK {
				return
			}
			var result bandwidth.Snapshot
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if response.Header().Get("Cache-Control") != "no-store" || result.TotalBytes != 2048 || len(result.History) != 60 {
				t.Fatalf("incorrect uncached snapshot: %+v", result)
			}
		})
	}
}

func TestBandwidthUnavailableIsNotReportedAsZero(t *testing.T) {
	router := gin.New()
	deps := &platform.Dependencies{Authenticate: func(*gin.Context) (*platform.Principal, error) {
		return &platform.Principal{Permissions: []string{"admin.dashboard.read"}}, nil
	}}
	(&service{deps: deps}).analyticsRoutes(router)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/admin/api/dashboard/bandwidth", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, body %s", response.Code, response.Body)
	}
}
