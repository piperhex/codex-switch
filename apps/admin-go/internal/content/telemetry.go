package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"time"
)

var platformNames = []string{"windows", "macos", "linux", "android", "ios"}

func (s *service) analyticsRoutes(r *gin.Engine) {
	r.POST("/telemetry/installations", s.recordInstallation)
	permission := s.deps.RequirePermissions("admin.telemetry.read")
	r.GET("/admin/api/telemetry/overview", permission, s.telemetryOverview)
	r.GET("/admin/api/telemetry/installations", permission, s.listInstallations)
	r.GET("/admin/api/telemetry/events", permission, s.listEvents)
	r.GET("/admin/api/dashboard/overview", s.deps.RequirePermissions("admin.dashboard.read"), s.dashboard)
}

type platformCountRow struct {
	Platform string
	Count    int64
}

func groupedPlatforms(query *gorm.DB) (map[string]int64, error) {
	rows := []platformCountRow{}
	err := query.Select("platform, COUNT(*) AS count").Group("platform").Scan(&rows).Error
	result := map[string]int64{}
	for _, name := range platformNames {
		result[name] = 0
	}
	for _, row := range rows {
		result[row.Platform] = row.Count
	}
	return result, err
}
func (s *service) telemetryOverview(c *gin.Context) {
	values := gin.H{}
	since := time.Now().AddDate(0, 0, -30)
	for _, entry := range []struct {
		Name  string
		Query *gorm.DB
	}{
		{"totalInstallations", s.deps.DB.Model(&DeviceInstallation{})},
		{"installationsLast30Days", s.deps.DB.Model(&DeviceInstallation{}).Where(`"firstSeenAt" >= ?`, since)},
		{"totalEvents", s.deps.DB.Model(&DeviceTelemetryEvent{})},
		{"eventsLast30Days", s.deps.DB.Model(&DeviceTelemetryEvent{}).Where(`"createdAt" >= ?`, since)},
	} {
		var count int64
		if err := entry.Query.Count(&count).Error; err != nil {
			platform.Respond(c, nil, err)
			return
		}
		values[entry.Name] = count
	}
	counts, err := groupedPlatforms(s.deps.DB.Model(&DeviceInstallation{}))
	values["platforms"] = counts
	platform.Respond(c, values, err)
}
func telemetryQuery(c *gin.Context, query *gorm.DB) *gorm.DB {
	query = searchQuery(c, query, []string{`CAST("deviceId" AS text)`})
	if value := c.Query("platform"); value != "" {
		query = query.Where("platform = ?", value)
	}
	return query
}
func (s *service) listInstallations(c *gin.Context) {
	value, err := paginate[DeviceInstallation](
		c,
		telemetryQuery(c, s.deps.DB.Model(&DeviceInstallation{})),
		`"firstSeenAt" DESC`,
	)
	platform.Respond(c, value, err)
}
func (s *service) listEvents(c *gin.Context) {
	query := telemetryQuery(c, s.deps.DB.Model(&DeviceTelemetryEvent{}))
	if value := c.Query("eventType"); value != "" {
		query = query.Where(`"eventType" = ?`, value)
	}
	value, err := paginate[DeviceTelemetryEvent](c, query, `"createdAt" DESC`)
	platform.Respond(c, value, err)
}
