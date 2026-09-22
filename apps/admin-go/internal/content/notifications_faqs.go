package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"strings"
)

func presentNotification(item AppNotification) gin.H {
	return gin.H{"id": item.Id, "titleZh": item.TitleZh, "titleEn": item.TitleEn, "contentZh": item.ContentZh,
		"contentEn": item.ContentEn, "link": item.Link, "linkLabelZh": item.LinkLabelZh, "linkLabelEn": item.LinkLabelEn,
		"enabled": item.Enabled, "publishedAt": iso(item.PublishedAt), "updatedAt": iso(item.UpdatedAt)}
}
func (s *service) listNotifications(c *gin.Context, public bool) {
	query := s.deps.DB.Order(`"publishedAt" DESC, "createdAt" DESC`).Limit(100)
	if public {
		query = query.Where("enabled = ?", true).Limit(20)
	}
	items := []AppNotification{}
	err := query.Find(&items).Error
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, presentNotification(item))
	}
	platform.Respond(c, result, err)
}
func (s *service) listPublicNotifications(c *gin.Context) { s.listNotifications(c, true) }
func (s *service) listAdminNotifications(c *gin.Context)  { s.listNotifications(c, false) }

type notificationInput struct {
	TitleZh, TitleEn, ContentZh, ContentEn, Link, LinkLabelZh, LinkLabelEn, PublishedAt string
	Enabled                                                                             bool
}

func (s *service) saveNotification(c *gin.Context) {
	var input notificationInput
	if !bind(c, &input) {
		return
	}
	item := AppNotification{Id: newID()}
	action := "notification.create"
	if id := c.Param("id"); id != "" {
		item.Id = id
		if err := s.deps.DB.First(&item, "id = ?", id).Error; err != nil {
			platform.Respond(c, nil, missing(err, "Notification not found"))
			return
		}
		action = "notification.update"
	}
	item.TitleZh, item.TitleEn = strings.TrimSpace(input.TitleZh), strings.TrimSpace(input.TitleEn)
	item.ContentZh, item.ContentEn = strings.TrimSpace(input.ContentZh), strings.TrimSpace(input.ContentEn)
	if item.TitleZh == "" || item.TitleEn == "" || item.ContentZh == "" || item.ContentEn == "" {
		platform.Fail(c, 400, "Chinese and English notification titles and content are required")
		return
	}
	published, err := parseDate(input.PublishedAt)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item.Link, item.LinkLabelZh, item.LinkLabelEn = strings.TrimSpace(
		input.Link,
	), strings.TrimSpace(
		input.LinkLabelZh,
	), strings.TrimSpace(
		input.LinkLabelEn,
	)
	item.Enabled, item.PublishedAt = input.Enabled, published
	actor := platform.User(c)
	item.UpdatedById, item.UpdatedByEmail = ptr(actor.ID), actor.Email
	if err = s.deps.DB.Save(&item).Error; err == nil {
		err = audit(s.deps.DB, actor, auditOptions{Action: action, TargetType: "notification", TargetID: item.Id,
			Metadata: gin.H{"enabled": item.Enabled, "publishedAt": iso(item.PublishedAt)}})
	}
	platform.Respond(c, presentNotification(item), err)
}
func (s *service) deleteNotification(c *gin.Context) {
	var item AppNotification
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Notification not found"))
		return
	}
	err := s.deps.DB.Delete(&item).Error
	if err == nil {
		err = audit(
			s.deps.DB,
			platform.User(c),
			auditOptions{
				Action:     "notification.delete",
				TargetType: "notification",
				TargetID:   item.Id,
				Metadata:   gin.H{"titleZh": item.TitleZh, "titleEn": item.TitleEn},
			},
		)
	}
	platform.Respond(c, ok(), err)
}
func presentFAQ(item AppFaq) gin.H {
	return gin.H{"id": item.Id, "questionZh": item.QuestionZh, "questionEn": item.QuestionEn, "answerZh": item.AnswerZh,
		"answerEn": item.AnswerEn, "enabled": item.Enabled, "sortOrder": item.SortOrder,
		"createdAt": iso(item.CreatedAt), "updatedAt": iso(item.UpdatedAt)}
}
func (s *service) listFAQs(c *gin.Context, public bool) {
	query := s.deps.DB.Order(`"sortOrder" ASC, "createdAt" ASC`)
	if public {
		query = query.Where("enabled = ?", true)
	}
	items := []AppFaq{}
	err := query.Find(&items).Error
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, presentFAQ(item))
	}
	platform.Respond(c, result, err)
}
func (s *service) listPublicFAQs(c *gin.Context) { s.listFAQs(c, true) }
func (s *service) listAdminFAQs(c *gin.Context)  { s.listFAQs(c, false) }

type faqInput struct {
	QuestionZh, QuestionEn, AnswerZh, AnswerEn string
	Enabled                                    bool
	SortOrder                                  int64
}

func (s *service) saveFAQ(c *gin.Context) {
	var input faqInput
	if !bind(c, &input) {
		return
	}
	item := AppFaq{Id: newID()}
	action := "faq.create"
	if id := c.Param("id"); id != "" {
		item.Id = id
		if err := s.deps.DB.First(&item, "id = ?", id).Error; err != nil {
			platform.Respond(c, nil, missing(err, "FAQ not found"))
			return
		}
		action = "faq.update"
	}
	item.QuestionZh, item.QuestionEn = strings.TrimSpace(input.QuestionZh), strings.TrimSpace(input.QuestionEn)
	item.AnswerZh, item.AnswerEn = strings.TrimSpace(input.AnswerZh), strings.TrimSpace(input.AnswerEn)
	if item.QuestionZh == "" || item.QuestionEn == "" || item.AnswerZh == "" || item.AnswerEn == "" {
		platform.Fail(c, 400, "Chinese and English FAQ questions and answers are required")
		return
	}
	actor := platform.User(c)
	item.Enabled, item.SortOrder = input.Enabled, input.SortOrder
	item.UpdatedById, item.UpdatedByEmail = ptr(actor.ID), actor.Email
	err := s.deps.DB.Save(&item).Error
	if err == nil {
		err = audit(
			s.deps.DB,
			actor,
			auditOptions{
				Action:     action,
				TargetType: "faq",
				TargetID:   item.Id,
				Metadata:   gin.H{"enabled": item.Enabled, "sortOrder": item.SortOrder},
			},
		)
	}
	platform.Respond(c, presentFAQ(item), err)
}
func (s *service) deleteFAQ(c *gin.Context) {
	var item AppFaq
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "FAQ not found"))
		return
	}
	err := s.deps.DB.Delete(&item).Error
	if err == nil {
		err = audit(
			s.deps.DB,
			platform.User(c),
			auditOptions{
				Action:     "faq.delete",
				TargetType: "faq",
				TargetID:   item.Id,
				Metadata:   gin.H{"questionZh": item.QuestionZh, "questionEn": item.QuestionEn},
			},
		)
	}
	platform.Respond(c, ok(), err)
}
