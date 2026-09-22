package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
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
func (s *service) recordInstallation(c *gin.Context) {
	var input struct {
		DeviceId, Platform, EventType string
		AppVersion                    *string
	}
	if !bind(c, &input) {
		return
	}
	item := DeviceInstallation{DeviceId: input.DeviceId, Platform: input.Platform, FirstSeenAt: time.Now()}
	columns := []string{"platform"}
	if input.AppVersion != nil && strings.TrimSpace(*input.AppVersion) != "" {
		item.AppVersion = ptr(strings.TrimSpace(*input.AppVersion))
		columns = append(columns, "appVersion")
	}
	conflict := clause.OnConflict{
		Columns: []clause.Column{{Name: "deviceId"}}, DoUpdates: clause.AssignmentColumns(columns),
	}
	err := s.deps.DB.Clauses(conflict).Create(&item).Error
	if err == nil && input.EventType != "installation" {
		err = s.deps.DB.Create(
			&DeviceTelemetryEvent{
				Id:        newID(),
				DeviceId:  input.DeviceId,
				Platform:  input.Platform,
				EventType: input.EventType,
			},
		).Error
	}
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	platform.WriteJSON(c, 200, ok())
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
