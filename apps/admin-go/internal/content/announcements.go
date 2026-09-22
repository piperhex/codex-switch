package content

import (
	"errors"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const defaultTextColor = "#C4D7C8"
const defaultBackgroundColor = "#203128"

func (s *service) announcementRoutes(r *gin.Engine) {
	read := s.deps.RequirePermissions("admin.announcements.read")
	manage := s.deps.RequirePermissions("admin.announcements.manage")
	r.GET("/announcements/current", noStore, s.getPublicAnnouncement)
	r.GET("/admin/api/announcement", read, s.getAdminAnnouncement)
	r.PATCH("/admin/api/announcement", manage, s.updateAnnouncement)
	r.POST("/announcements/clicks", s.recordClick)
	r.POST("/announcements/clicks/authenticated", s.deps.RequireAuth(), s.recordClick)
	r.GET("/admin/api/announcement/clicks/overview", read, s.clickOverview)
	r.GET("/admin/api/announcement/clicks", read, s.listClicks)
	r.GET("/notifications/recent", noStore, s.listPublicNotifications)
	r.GET("/admin/api/notifications", read, s.listAdminNotifications)
	r.POST("/admin/api/notifications", manage, s.saveNotification)
	r.PATCH("/admin/api/notifications/:id", manage, s.saveNotification)
	r.DELETE("/admin/api/notifications/:id", manage, s.deleteNotification)
	r.GET("/faqs", noStore, s.listPublicFAQs)
	r.GET("/admin/api/faqs", read, s.listAdminFAQs)
	r.POST("/admin/api/faqs", manage, s.saveFAQ)
	r.PATCH("/admin/api/faqs/:id", manage, s.saveFAQ)
	r.DELETE("/admin/api/faqs/:id", manage, s.deleteFAQ)
}

func (s *service) currentAnnouncement() (AppAnnouncement, error) {
	item := AppAnnouncement{Id: "current", TextColor: defaultTextColor, BackgroundColor: defaultBackgroundColor,
		DarkTextColor: defaultTextColor, DarkBackgroundColor: defaultBackgroundColor, ScrollDurationSeconds: 22}
	err := s.deps.DB.First(&item, "id = ?", "current").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return item, nil
	}
	return item, err
}
func presentAnnouncement(item AppAnnouncement, public bool) gin.H {
	zh, en, link, enabled := item.ContentZh, item.ContentEn, item.Link, item.Enabled
	if public {
		zh, en = strings.TrimSpace(zh), strings.TrimSpace(en)
		enabled = enabled && zh != "" && en != ""
		if enabled {
			link = strings.TrimSpace(link)
		} else {
			zh, en, link = "", "", ""
		}
	}
	return gin.H{"content": zh, "contentZh": zh, "contentEn": en, "link": link, "enabled": enabled,
		"textColor": item.TextColor, "backgroundColor": item.BackgroundColor, "darkTextColor": item.DarkTextColor,
		"darkBackgroundColor": item.DarkBackgroundColor, "scrollDurationSeconds": item.ScrollDurationSeconds,
		"updatedAt": dateOrNil(item.UpdatedAt)}
}
func (s *service) getPublicAnnouncement(c *gin.Context) {
	item, err := s.currentAnnouncement()
	platform.Respond(c, presentAnnouncement(item, true), err)
}
func (s *service) getAdminAnnouncement(c *gin.Context) {
	item, err := s.currentAnnouncement()
	platform.Respond(c, presentAnnouncement(item, false), err)
}

type announcementInput struct {
	ContentZh             string  `json:"contentZh"`
	ContentEn             string  `json:"contentEn"`
	Link                  string  `json:"link"`
	Enabled               bool    `json:"enabled"`
	TextColor             string  `json:"textColor"`
	BackgroundColor       string  `json:"backgroundColor"`
	DarkTextColor         *string `json:"darkTextColor"`
	DarkBackgroundColor   *string `json:"darkBackgroundColor"`
	ScrollDurationSeconds int64   `json:"scrollDurationSeconds"`
}

func (s *service) updateAnnouncement(c *gin.Context) {
	var input announcementInput
	if !bind(c, &input) {
		return
	}
	input.ContentZh, input.ContentEn = strings.TrimSpace(input.ContentZh), strings.TrimSpace(input.ContentEn)
	if input.Enabled && (input.ContentZh == "" || input.ContentEn == "") {
		platform.Fail(c, 400, "Chinese and English announcement content are required when enabled")
		return
	}
	item, err := s.currentAnnouncement()
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item.ContentZh, item.ContentEn, item.Link = input.ContentZh, input.ContentEn, strings.TrimSpace(input.Link)
	item.Enabled, item.ScrollDurationSeconds = input.Enabled, input.ScrollDurationSeconds
	item.TextColor, item.BackgroundColor = strings.ToUpper(input.TextColor), strings.ToUpper(input.BackgroundColor)
	if input.DarkTextColor != nil {
		item.DarkTextColor = strings.ToUpper(*input.DarkTextColor)
	}
	if input.DarkBackgroundColor != nil {
		item.DarkBackgroundColor = strings.ToUpper(*input.DarkBackgroundColor)
	}
	actor := platform.User(c)
	item.UpdatedById, item.UpdatedByEmail = ptr(actor.ID), actor.Email
	if err = s.deps.DB.Save(&item).Error; err == nil {
		err = audit(s.deps.DB, actor, auditOptions{
			Action: "announcement.update", TargetType: "announcement", TargetID: "current",
			Metadata: gin.H{"enabled": item.Enabled, "scrollDurationSeconds": item.ScrollDurationSeconds}})
	}
	platform.Respond(c, presentAnnouncement(item, false), err)
}

func (s *service) recordClick(c *gin.Context) {
	var input struct {
		DeviceId, Platform, Link string
		AnnouncementUpdatedAt    *string
	}
	if !bind(c, &input) {
		return
	}
	item := AnnouncementLinkClick{Id: newID(), DeviceId: input.DeviceId,
		Platform: input.Platform, Link: strings.TrimSpace(input.Link)}
	if input.AnnouncementUpdatedAt != nil {
		parsed, err := parseDate(*input.AnnouncementUpdatedAt)
		if err != nil {
			platform.Fail(c, 400, "Bad Request")
			return
		}
		item.AnnouncementUpdatedAt = &parsed
	}
	if actor := platform.User(c); actor != nil {
		item.Email = ptr(actor.Email)
	}
	if err := s.deps.DB.Create(&item).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	platform.WriteJSON(c, 200, ok())
}
func parseDate(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02", "2006-01-02T15:04:05", "2006-01-02T15:04"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, platform.NewError(400, "Bad Request")
}
func (s *service) listClicks(c *gin.Context) {
	query := searchQuery(c, s.deps.DB.Model(&AnnouncementLinkClick{}), []string{`CAST("deviceId" AS text)`, `email`})
	if value := c.Query("platform"); value != "" {
		query = query.Where("platform = ?", value)
	}
	value, err := paginate[AnnouncementLinkClick](c, query, `"createdAt" DESC`)
	platform.Respond(c, value, err)
}
func (s *service) clickOverview(c *gin.Context) {
	db := s.deps.DB
	var total, recent int64
	err := db.Model(&AnnouncementLinkClick{}).Count(&total).Error
	if err == nil {
		err = db.Model(&AnnouncementLinkClick{}).
			Where(`"createdAt" >= ?`, time.Now().AddDate(0, 0, -30)).
			Count(&recent).
			Error
	}
	counts, countErr := groupedPlatforms(db.Model(&AnnouncementLinkClick{}))
	if err == nil {
		err = countErr
	}
	platform.Respond(c, gin.H{"totalClicks": total, "clicksLast30Days": recent, "platforms": counts}, err)
}
