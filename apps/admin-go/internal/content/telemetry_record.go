package content

import (
	"errors"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/telemetryguard"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type installationInput struct {
	DeviceId   string  `json:"deviceId"`
	Platform   string  `json:"platform"`
	EventType  string  `json:"eventType"`
	AppVersion *string `json:"appVersion"`
}

const telemetryLockNamespace = 761830

func (s *service) recordInstallation(c *gin.Context) {
	var input installationInput
	if !bind(c, &input) {
		return
	}
	// Normalize UUID spelling so capitalization cannot create separate rate-limit identities.
	input.DeviceId = strings.ToLower(input.DeviceId)
	if err := s.telemetry.CheckDevice(c.Request.Context(), input.DeviceId); err != nil {
		telemetryguard.Respond(c, err)
		return
	}
	err := s.deps.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		return s.recordTelemetry(tx, telemetryguard.Source(c), input)
	})
	if err != nil {
		telemetryguard.Respond(c, err)
		return
	}
	platform.WriteJSON(c, 200, ok())
}

func (s *service) recordTelemetry(tx *gorm.DB, source string, input installationInput) error {
	// A transaction-scoped lock also serializes first registration, where no row exists yet.
	if err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended(?, ?))`,
		input.DeviceId, telemetryLockNamespace).Error; err != nil {
		return err
	}
	var item DeviceInstallation
	err := tx.Where(`"deviceId" = ?`, input.DeviceId).First(&item).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if input.EventType != "installation" {
			return nil
		}
		if err := s.telemetry.CheckInstallation(tx.Statement.Context, source); err != nil {
			return err
		}
	}
	if input.EventType == "installation" {
		if err := saveInstallation(tx, input); err != nil {
			return err
		}
		// Registering is activity too. This preserves first-day activity for older clients
		// that race their installation and activity requests.
		input.EventType = "activity"
	} else {
		// Activity metadata must not rewrite the platform or version of an installation.
		input.Platform = item.Platform
	}
	return recordTelemetryEvent(tx, input)
}

func saveInstallation(tx *gorm.DB, input installationInput) error {
	item := DeviceInstallation{DeviceId: input.DeviceId, Platform: input.Platform, FirstSeenAt: time.Now()}
	columns := []string{"platform"}
	if input.AppVersion != nil && strings.TrimSpace(*input.AppVersion) != "" {
		item.AppVersion = ptr(strings.TrimSpace(*input.AppVersion))
		columns = append(columns, "appVersion")
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "deviceId"}}, DoUpdates: clause.AssignmentColumns(columns),
	}).Create(&item).Error
}

func recordTelemetryEvent(tx *gorm.DB, input installationInput) error {
	now := time.Now().UTC()
	if input.EventType == "activity" {
		var count int64
		start := now.Truncate(24 * time.Hour)
		err := tx.Model(&DeviceTelemetryEvent{}).
			Where(`"deviceId" = ? AND "eventType" = ? AND "createdAt" >= ? AND "createdAt" < ?`,
				input.DeviceId, input.EventType, start, start.AddDate(0, 0, 1)).Count(&count).Error
		if err != nil || count > 0 {
			return err
		}
	}
	return tx.Create(&DeviceTelemetryEvent{
		Id: newID(), DeviceId: input.DeviceId, Platform: input.Platform,
		EventType: input.EventType, CreatedAt: now,
	}).Error
}
