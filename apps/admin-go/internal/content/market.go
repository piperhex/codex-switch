package content

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"regexp"
	"strings"
	"unicode/utf8"
)

var versionPattern = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$`)

func (s *service) marketRoutes(r *gin.Engine) {
	r.GET("/prompt-plugins", s.listPlugins)
	r.POST("/prompt-plugins", s.deps.RequireAuth(), s.savePlugin)
	r.PATCH("/prompt-plugins/:id", s.deps.RequireAuth(), s.savePlugin)
	r.GET("/prompt-plugins/:id/install", s.installPlugin)
	r.GET("/admin/api/prompt-plugins", s.deps.RequirePermissions("admin.prompt-plugins.read"), s.listAdminPlugins)
	r.PATCH(
		"/admin/api/prompt-plugins/:id",
		s.deps.RequirePermissions("admin.prompt-plugins.manage"),
		s.adminUpdatePlugin,
	)
	r.DELETE("/admin/api/prompt-plugins/:id", s.deps.RequirePermissions("admin.prompt-plugins.manage"), s.deletePlugin)
	r.GET("/skills", s.listSkills)
	r.POST("/skills", s.deps.RequireAuth(), s.saveSkill)
	r.PATCH("/skills/:id", s.deps.RequireAuth(), s.saveSkill)
	r.GET("/skills/:id/download", s.downloadSkill)
	r.GET("/skills/:id/preview", s.previewSkill)
	r.GET("/admin/api/skills", s.deps.RequirePermissions("admin.skills.read"), s.listAdminSkills)
	r.PATCH("/admin/api/skills/:id", s.deps.RequirePermissions("admin.skills.manage"), s.adminUpdateSkill)
	r.DELETE("/admin/api/skills/:id", s.deps.RequirePermissions("admin.skills.manage"), s.deleteSkill)
}

type pluginInput struct{ Name, Version, Type, Text string }
type pluginPatch struct{ Name, Version, Type, Text *string }

func validatePlugin(input pluginInput) (pluginInput, error) {
	input.Name, input.Version = strings.TrimSpace(input.Name), strings.TrimSpace(input.Version)
	input.Text = strings.TrimSpace(input.Text)
	if input.Name == "" || input.Version == "" || input.Text == "" {
		return input, platform.NewError(400, "Prompt plugin fields are required")
	}
	if !versionPattern.MatchString(input.Version) {
		return input, platform.NewError(400, "Prompt plugin version contains unsupported characters")
	}
	limit := 5000
	if input.Type == "filter" {
		limit = 500
	}
	if utf8.RuneCountInString(input.Text) > limit {
		message := "Prompt plugin injection text must not exceed 5000 characters"
		if input.Type == "filter" {
			message = "Prompt plugin filter text must not exceed 500 characters"
		}
		return input, platform.NewError(400, message)
	}
	return input, nil
}
func presentPlugin(item PromptPluginItem, admin bool) gin.H {
	value := gin.H{"id": item.Id, "name": item.Name, "version": item.Version, "type": item.Type, "text": item.Text,
		"uploaderId": item.UploaderId, "installCount": item.InstallCount,
		"createdAt": iso(item.CreatedAt), "updatedAt": iso(item.UpdatedAt)}
	if admin {
		value["uploaderEmail"] = item.UploaderEmail
	}
	return value
}
func (s *service) listPlugins(c *gin.Context) {
	items := []PromptPluginItem{}
	err := s.deps.DB.Order(`"createdAt" DESC`).Limit(200).Find(&items).Error
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, presentPlugin(item, false))
	}
	platform.Respond(c, gin.H{"items": result}, err)
}
func (s *service) listAdminPlugins(c *gin.Context) {
	query := searchQuery(c, s.deps.DB.Model(&PromptPluginItem{}), []string{`name`, `text`, `"uploaderEmail"`})
	value, err := paginate[PromptPluginItem](c, query, `"createdAt" DESC`)
	if err == nil {
		items := value["items"].([]PromptPluginItem)
		result := make([]gin.H, 0, len(items))
		for _, item := range items {
			result = append(result, presentPlugin(item, true))
		}
		value["items"] = result
	}
	platform.Respond(c, value, err)
}
func (s *service) savePlugin(c *gin.Context) {
	var input pluginInput
	if !bind(c, &input) {
		return
	}
	actor := platform.User(c)
	item := PromptPluginItem{Id: newID(), UploaderId: ptr(actor.ID), UploaderEmail: actor.Email}
	id := c.Param("id")
	if id != "" {
		item.Id = id
		if err := s.deps.DB.First(&item, "id = ?", id).Error; err != nil {
			platform.Respond(c, nil, missing(err, "Prompt plugin does not exist"))
			return
		}
		if item.UploaderId == nil || *item.UploaderId != actor.ID {
			platform.Fail(c, 403, "Only the publisher can modify this prompt plugin")
			return
		}
	}
	normalized, err := validatePlugin(input)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if id != "" && normalized.Version == item.Version {
		platform.Fail(c, 400, "A new release must use a different version")
		return
	}
	item.Name, item.Version, item.Type, item.Text = normalized.Name, normalized.Version, normalized.Type, normalized.Text
	err = s.deps.DB.Save(&item).Error
	platform.Respond(c, presentPlugin(item, false), err)
}
func (s *service) installPlugin(c *gin.Context) {
	var item PromptPluginItem
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Prompt plugin does not exist"))
		return
	}
	err := s.deps.DB.Model(&PromptPluginItem{}).Where("id = ?", item.Id).
		Update("installCount", gorm.Expr(`"installCount" + 1`)).Error
	platform.Respond(c, presentPlugin(item, false), err)
}
func (s *service) adminUpdatePlugin(c *gin.Context) {
	var patch pluginPatch
	if !bind(c, &patch) {
		return
	}
	var item PromptPluginItem
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Prompt plugin does not exist"))
		return
	}
	if c.GetBool("bodyIsArray") {
		platform.Fail(c, 400, "At least one prompt plugin field is required")
		return
	}
	input := pluginInput{item.Name, item.Version, item.Type, item.Text}
	// ES2022 DTO class fields are enumerable even when absent from the request.
	fields := []string{"name", "version", "type", "text"}
	for _, field := range []struct {
		name   string
		source *string
		target *string
	}{
		{"name", patch.Name, &input.Name}, {"version", patch.Version, &input.Version},
		{"type", patch.Type, &input.Type}, {"text", patch.Text, &input.Text},
	} {
		if field.source != nil {
			*field.target = *field.source
		}
	}
	input, err := validatePlugin(input)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item.Name, item.Version, item.Type, item.Text = input.Name, input.Version, input.Type, input.Text
	if err = s.deps.DB.Save(&item).Error; err == nil {
		err = audit(s.deps.DB, platform.User(c), auditOptions{
			Action: "prompt-plugin.update", TargetType: "prompt-plugin", TargetID: item.Id,
			TargetEmail: ptr(item.UploaderEmail), Metadata: gin.H{"fields": fields}})
	}
	platform.Respond(c, presentPlugin(item, true), err)
}
func (s *service) deletePlugin(c *gin.Context) {
	var item PromptPluginItem
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Prompt plugin does not exist"))
		return
	}
	err := s.deps.DB.Delete(&item).Error
	if err == nil {
		err = audit(s.deps.DB, platform.User(c), auditOptions{
			Action: "prompt-plugin.delete", TargetType: "prompt-plugin", TargetID: item.Id,
			TargetEmail: ptr(item.UploaderEmail),
			Metadata:    gin.H{"name": item.Name, "version": item.Version, "installCount": item.InstallCount}})
	}
	platform.Respond(c, ok(), err)
}
