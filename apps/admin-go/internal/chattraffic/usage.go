// Package chattraffic accounts for server relay bytes and enforces monthly user quotas.
package chattraffic

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

var Beijing = time.FixedZone("Asia/Shanghai", 8*60*60)
var ErrQuota = errors.New("monthly relay quota exceeded")

const MaxLimitBytes int64 = 9007199254740991

type Usage struct {
	MonthUsedBytes    int64     `json:"monthUsedBytes"`
	MonthlyLimitBytes int64     `json:"monthlyLimitBytes"`
	ResetAt           time.Time `json:"resetAt"`
}

func MonthStart(now time.Time) time.Time {
	local := now.In(Beijing)
	return time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, Beijing)
}

func Allowed(usage Usage, bytes int) bool {
	return bytes > 0 && (usage.MonthlyLimitBytes == -1 ||
		int64(bytes) <= usage.MonthlyLimitBytes-usage.MonthUsedBytes)
}

func ReadUsage(db *gorm.DB, owner string, now time.Time) (Usage, error) {
	month := MonthStart(now)
	usage := Usage{ResetAt: month.AddDate(0, 1, 0)}
	err := db.Raw(`SELECT COALESCE(l.monthly_limit_bytes,-1) AS monthly_limit_bytes,
 COALESCE(m.bytes,0) AS month_used_bytes FROM users u
 LEFT JOIN chat_relay_user_limits l ON l.user_id=u.id
 LEFT JOIN chat_relay_user_months m ON m.user_id=u.id AND m.month_start=? WHERE u.id=?`,
		month, owner).Scan(&usage).Error
	return usage, err
}

func lockUser(db *gorm.DB, owner string) error {
	if err := db.Exec(`INSERT INTO chat_relay_user_limits(user_id) VALUES (?)
 ON CONFLICT DO NOTHING`, owner).Error; err != nil {
		return err
	}
	var limit int64
	return db.Raw(`SELECT monthly_limit_bytes FROM chat_relay_user_limits WHERE user_id=? FOR UPDATE`,
		owner).Scan(&limit).Error
}

func record(db *gorm.DB, owner string, bytes int, now time.Time) error {
	if err := db.Exec(`INSERT INTO chat_relay_user_months(user_id,month_start,bytes) VALUES (?,?,?)
 ON CONFLICT(user_id,month_start) DO UPDATE SET bytes=chat_relay_user_months.bytes+EXCLUDED.bytes`,
		owner, MonthStart(now), bytes).Error; err != nil {
		return err
	}
	return db.Exec(`INSERT INTO chat_relay_user_hours(user_id,hour_start,bytes) VALUES (?,?,?)
 ON CONFLICT(user_id,hour_start) DO UPDATE SET bytes=chat_relay_user_hours.bytes+EXCLUDED.bytes`,
		owner, now.UTC().Truncate(time.Hour), bytes).Error
}
