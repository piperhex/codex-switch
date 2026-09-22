package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"time"
)

type datedCount struct {
	Date, Platform string
	Count          int64
}
type namedCount struct {
	Name  string
	Count int64
}
type dashboardSummary struct {
	TotalUsers            int64 `gorm:"column:totalUsers"            json:"totalUsers"`
	ActiveUsers           int64 `gorm:"column:activeUsers"           json:"activeUsers"`
	DailyActiveUsers      int64 `gorm:"column:dailyActiveUsers"      json:"dailyActiveUsers"`
	NewUsers              int64 `gorm:"column:newUsers"              json:"newUsers"`
	TotalInstallations    int64 `gorm:"column:totalInstallations"    json:"totalInstallations"`
	NewInstallations      int64 `gorm:"column:newInstallations"      json:"newInstallations"`
	OfficialAccounts      int64 `gorm:"column:officialAccounts"      json:"officialAccounts"`
	BoundOfficialAccounts int64 `gorm:"column:boundOfficialAccounts" json:"boundOfficialAccounts"`
	TotalBindings         int64 `gorm:"column:totalBindings"         json:"totalBindings"`
	PendingFeedback       int64 `gorm:"column:pendingFeedback"       json:"pendingFeedback"`
	RepliedFeedback       int64 `gorm:"column:repliedFeedback"       json:"repliedFeedback"`
	PendingApprovals      int64 `gorm:"column:pendingApprovals"      json:"pendingApprovals"`
}
type dashboardData struct {
	Summary                        dashboardSummary
	Users, Installations, Activity []datedCount
	Platforms, Plans, DailyActive  []namedCount
}

func namedPlatformCounts(rows []namedCount) []gin.H {
	counts := map[string]int64{}
	for _, row := range rows {
		counts[row.Name] = row.Count
	}
	result := make([]gin.H, 0, len(platformNames))
	for _, name := range platformNames {
		result = append(result, gin.H{"name": name, "value": counts[name]})
	}
	return result
}
func dateCounts(rows []datedCount, date string) (int64, []gin.H) {
	named := []namedCount{}
	var total int64
	for _, row := range rows {
		if row.Date == date {
			named = append(named, namedCount{row.Platform, row.Count})
			total += row.Count
		}
	}
	return total, namedPlatformCounts(named)
}
func buildDashboardTrend(data dashboardData, start time.Time, days int) ([]gin.H, []gin.H) {
	users := map[string]int64{}
	for _, row := range data.Users {
		users[row.Date] = row.Count
	}
	total := data.Summary.TotalInstallations
	for _, row := range data.Installations {
		total -= row.Count
	}
	trend, activity := make([]gin.H, 0, days), make([]gin.H, 0, days)
	for day := 0; day < days; day++ {
		date := start.AddDate(0, 0, day).Format("2006-01-02")
		installed, platforms := dateCounts(data.Installations, date)
		total += installed
		trend = append(trend, gin.H{"date": date, "users": users[date], "installations": installed,
			"totalInstallations": total, "platforms": platforms})
		active, activePlatforms := dateCounts(data.Activity, date)
		// Legacy activity totals include only supported platforms.
		active = 0
		for _, entry := range activePlatforms {
			active += entry["value"].(int64)
		}
		activity = append(activity, gin.H{"date": date, "total": active, "platforms": activePlatforms})
	}
	return trend, activity
}
func readDashboard(db *gorm.DB, start, until time.Time) (dashboardData, error) {
	var data dashboardData
	queries := []struct {
		SQL    string
		Args   []interface{}
		Target interface{}
	}{
		{dashboardSUMMARY, []interface{}{start, start}, &data.Summary},
		{dashboardUSERS, []interface{}{start}, &data.Users},
		{dashboardINSTALLATIONS, []interface{}{start}, &data.Installations},
		{dashboardPLATFORMS, nil, &data.Platforms},
		{dashboardPLANS, nil, &data.Plans}, {dashboardDAILY_ACTIVE, nil, &data.DailyActive},
		{dashboardDAILY_ACTIVE_TREND, []interface{}{start, until}, &data.Activity},
	}
	for _, query := range queries {
		if err := db.Raw(query.SQL, query.Args...).Scan(query.Target).Error; err != nil {
			return data, err
		}
	}
	return data, nil
}
func (s *service) dashboard(c *gin.Context) {
	if s.deps.FlushTraffic != nil {
		if err := s.deps.FlushTraffic(); err != nil {
			platform.Respond(c, nil, err)
			return
		}
	}
	days := queryInteger(c, "days", 30)
	if days != 7 && days != 30 && days != 90 {
		days = 30
	}
	now := time.Now().UTC()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1-days)
	data, err := readDashboard(s.deps.DB, start, start.AddDate(0, 0, days))
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	traffic, err := ReadTrafficOverview(s.deps.DB, days, now)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	trend, activity := buildDashboardTrend(data, start, days)
	plans := make([]gin.H, 0, len(data.Plans))
	for _, row := range data.Plans {
		plans = append(plans, gin.H{"name": row.Name, "value": row.Count})
	}
	platform.Respond(c, gin.H{
		"range":   gin.H{"days": days, "startDate": start.Format("2006-01-02"), "endDate": now.Format("2006-01-02")},
		"summary": data.Summary, "trend": trend, "chatTraffic": traffic, "dailyActiveTrend": activity,
		"dailyActivePlatforms": namedPlatformCounts(data.DailyActive), "platforms": namedPlatformCounts(data.Platforms),
		"accountPlans": plans,
		"feedback":     gin.H{"pending": data.Summary.PendingFeedback, "replied": data.Summary.RepliedFeedback},
	}, nil)
}

// ReadTrafficOverview returns complete Beijing days and the lifetime relay byte count.
func ReadTrafficOverview(db *gorm.DB, days int, now time.Time) (gin.H, error) {
	beijing := time.FixedZone("Asia/Shanghai", 8*60*60)
	local := now.In(beijing)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, beijing).AddDate(0, 0, 1-days)
	var total int64
	if err := db.Raw("SELECT COALESCE(SUM(bytes),0) FROM chat_relay_traffic").Scan(&total).Error; err != nil {
		return nil, err
	}
	rows := []struct {
		HourStart time.Time `gorm:"column:hour_start"`
		Bytes     int64
	}{}
	const query = `SELECT hour_start,SUM(bytes) AS bytes FROM chat_relay_traffic
 WHERE hour_start >= ? AND hour_start < ? GROUP BY hour_start`
	if err := db.Raw(query, start, start.AddDate(0, 0, days)).Scan(&rows).Error; err != nil {
		return nil, err
	}
	hours := map[int64]int64{}
	for _, row := range rows {
		hours[row.HourStart.Unix()] = row.Bytes
	}
	daily := make([]gin.H, 0, days)
	for day := 0; day < days; day++ {
		date := start.AddDate(0, 0, day)
		hourly := make([]int64, 24)
		var sum int64
		for hour := 0; hour < 24; hour++ {
			hourly[hour] = hours[date.Add(time.Duration(hour)*time.Hour).Unix()]
			sum += hourly[hour]
		}
		daily = append(daily, gin.H{"date": date.Format("2006-01-02"), "bytes": sum, "hourlyBytes": hourly})
	}
	return gin.H{"totalBytes": total, "daily": daily}, nil
}
