package content

import (
	"github.com/codex-switch/admin-go/internal/identity"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"mime"
	"strings"
	"time"
)

const maxFeedbackImageBytes = 5 * 1024 * 1024

func (s *service) feedbackRoutes(r *gin.Engine) {
	read := s.deps.RequirePermissions("admin.feedback.read")
	r.POST("/feedback", s.submitFeedback)
	r.POST("/feedback/authenticated", s.deps.RequireAuth(), s.submitFeedback)
	r.GET("/admin/api/feedback", read, s.listFeedback)
	r.GET("/admin/api/feedback/:id", read, s.getFeedback)
	r.GET("/admin/api/feedback/:id/attachments/:attachmentId", read, s.getFeedbackAttachment)
	r.POST("/admin/api/feedback/:id/email", s.deps.RequirePermissions("admin.feedback.manage"), s.emailFeedback)
}

type feedbackInput struct {
	Content  string  `json:"content"  form:"content"`
	Version  string  `json:"version"  form:"version"`
	Platform string  `json:"platform" form:"platform"`
	Email    *string `json:"email"    form:"email"`
}

func bindFeedback(c *gin.Context) (feedbackInput, []*uploadedFile, error) {
	var input feedbackInput
	images := []*uploadedFile{}
	if !strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		err := c.ShouldBindJSON(&input)
		return input, images, err
	}
	form, err := c.MultipartForm()
	if err != nil {
		return input, nil, platform.NewError(400, "Bad Request")
	}
	for name, files := range form.File {
		if name != "images" || len(files) > 4 {
			return input, nil, platform.NewError(400, "Unexpected field - "+name)
		}
		for _, header := range files {
			mimeType, _, _ := mime.ParseMediaType(header.Header.Get("Content-Type"))
			if !imageMIME(mimeType) {
				return input, nil, platform.NewError(400, "Only JPEG, PNG and WebP images are supported")
			}
			image, err := readUpload(header, maxFeedbackImageBytes)
			if err != nil {
				return input, nil, err
			}
			images = append(images, image)
		}
	}
	err = c.ShouldBind(&input)
	return input, images, err
}
func (s *service) submitFeedback(c *gin.Context) {
	input, images, err := bindFeedback(c)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	input.Content, input.Version = strings.TrimSpace(input.Content), strings.TrimSpace(input.Version)
	input.Platform = strings.TrimSpace(input.Platform)
	for _, field := range []struct{ name, value string }{
		{"content", input.Content}, {"version", input.Version}, {"platform", input.Platform},
	} {
		if field.value == "" {
			platform.Fail(c, 400, "Feedback "+field.name+" is required")
			return
		}
	}
	for _, image := range images {
		if !imageSignature(image) {
			platform.Fail(c, 400, "Feedback image data is invalid")
			return
		}
	}
	item := Feedback{Id: newID(), Content: input.Content, Version: input.Version, Platform: input.Platform}
	if input.Email != nil && strings.TrimSpace(*input.Email) != "" {
		item.Email = ptr(strings.TrimSpace(*input.Email))
	}
	if user := platform.User(c); user != nil {
		item.UserId = ptr(user.ID)
		item.Email = ptr(user.Email)
	}
	err = s.deps.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&item).Error; err != nil {
			return err
		}
		for _, image := range images {
			attachment := FeedbackAttachment{Id: newID(), FeedbackId: item.Id,
				FileName: truncateName(image.Name, "feedback-image"), MimeType: image.MIME,
				Size: int64(len(image.Data)), Data: image.Data}
			if err := tx.Create(&attachment).Error; err != nil {
				return err
			}
		}
		return nil
	})
	platform.Respond(c, gin.H{"id": item.Id, "createdAt": iso(item.CreatedAt)}, err)
}
func (s *service) presentFeedback(item Feedback) (gin.H, error) {
	attachments := []FeedbackAttachment{}
	err := s.deps.DB.Omit("Data").Where(`"feedbackId" = ?`, item.Id).Find(&attachments).Error
	images := make([]gin.H, 0, len(attachments))
	for _, image := range attachments {
		images = append(images, gin.H{"id": image.Id, "fileName": image.FileName,
			"mimeType": image.MimeType, "size": image.Size})
	}
	var replied interface{}
	if item.LastRepliedAt != nil {
		replied = iso(*item.LastRepliedAt)
	}
	return gin.H{"id": item.Id, "content": item.Content, "version": item.Version,
		"platform": item.Platform, "email": item.Email, "attachments": images, "lastRepliedAt": replied,
		"lastRepliedByEmail": item.LastRepliedByEmail, "createdAt": iso(item.CreatedAt)}, err
}
func (s *service) listFeedback(c *gin.Context) {
	result, err := paginate[Feedback](c, s.deps.DB.Model(&Feedback{}), `"createdAt" DESC`)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	items := result["items"].([]Feedback)
	values := make([]gin.H, 0, len(items))
	for _, item := range items {
		value, presentErr := s.presentFeedback(item)
		if presentErr != nil {
			platform.Respond(c, nil, presentErr)
			return
		}
		values = append(values, value)
	}
	result["items"] = values
	platform.Respond(c, result, nil)
}
func (s *service) getFeedback(c *gin.Context) {
	var item Feedback
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Feedback does not exist"))
		return
	}
	value, err := s.presentFeedback(item)
	platform.Respond(c, value, err)
}
func (s *service) getFeedbackAttachment(c *gin.Context) {
	var item FeedbackAttachment
	err := s.deps.DB.First(&item, `id = ? AND "feedbackId" = ?`, c.Param("attachmentId"), c.Param("id")).Error
	if err != nil {
		platform.Respond(c, nil, missing(err, "Feedback attachment does not exist"))
		return
	}
	c.Header("Content-Disposition", "inline")
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(200, item.MimeType, item.Data)
}
func (s *service) emailFeedback(c *gin.Context) {
	var input struct {
		Subject, Content string
		MailServiceId    *string
	}
	if !bind(c, &input) {
		return
	}
	var item Feedback
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Feedback does not exist"))
		return
	}
	if item.Email == nil || *item.Email == "" {
		platform.Fail(c, 400, "This feedback has no contact email")
		return
	}
	input.Subject, input.Content = strings.TrimSpace(input.Subject), strings.TrimSpace(input.Content)
	if input.Subject == "" || input.Content == "" {
		platform.Fail(c, 400, "Email subject and content are required")
		return
	}
	err := identity.SendMail(s.deps, identity.MailOptions{ServiceID: input.MailServiceId,
		To: *item.Email, Subject: input.Subject, Text: input.Content})
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	actor := platform.User(c)
	item.LastRepliedAt = ptr(time.Now())
	item.LastRepliedById = ptr(actor.ID)
	item.LastRepliedByEmail = ptr(actor.Email)
	if err = s.deps.DB.Save(&item).Error; err == nil {
		err = audit(s.deps.DB, actor, auditOptions{Action: "feedback.email.send", TargetType: "feedback",
			TargetID: item.Id, TargetEmail: item.Email,
			Metadata: gin.H{"subject": input.Subject, "mailServiceId": input.MailServiceId}})
	}
	platform.Respond(c, gin.H{"ok": true, "lastRepliedAt": iso(*item.LastRepliedAt)}, err)
}
