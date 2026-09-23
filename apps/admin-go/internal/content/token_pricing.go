package content

import (
	"errors"
	"net/http"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/codex-switch/admin-go/internal/tokenpricing"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type tokenPricingSettings struct {
	ID        string                `gorm:"column:id;primaryKey"`
	Presets   tokenpricing.Document `gorm:"column:presets;serializer:json"`
	UpdatedAt time.Time             `gorm:"column:updated_at;autoUpdateTime"`
}

func (tokenPricingSettings) TableName() string { return "token_cost_preset_settings" }

func (s *service) tokenPricingRoutes(r *gin.Engine) {
	r.GET("/token-cost-presets", noStore, s.readTokenPricing)
	r.GET("/admin/api/token-cost-presets", s.deps.RequirePermissions("admin.token-pricing.read"), noStore, s.readTokenPricing)
	r.PATCH("/admin/api/token-cost-presets", s.deps.RequirePermissions("admin.token-pricing.manage"), s.updateTokenPricing)
}

func (s *service) readTokenPricing(c *gin.Context) {
	item := tokenPricingSettings{ID: "current", Presets: tokenpricing.Defaults()}
	err := s.deps.DB.First(&item, "id = ?", "current").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	platform.Respond(c, item.Presets, err)
}

func (s *service) updateTokenPricing(c *gin.Context) {
	const maxPayloadBytes = 2 * 1024 * 1024
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPayloadBytes)
	var document tokenpricing.Document
	if !bind(c, &document) {
		return
	}
	document.VerifiedAt = time.Now().UTC().Format("2006-01-02")
	if err := document.Validate(); err != nil {
		platform.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	actor := platform.User(c)
	item := tokenPricingSettings{ID: "current", Presets: document}
	err := s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&item).Error; err != nil {
			return err
		}
		return audit(tx, actor, auditOptions{Action: "token-pricing.update", TargetType: "token-pricing",
			TargetID: "current", Metadata: gin.H{"presetCount": len(document.Models)}})
	})
	platform.Respond(c, document, err)
}
