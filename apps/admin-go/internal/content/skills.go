package content

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"mime/multipart"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func presentSkill(item SkillMarketItem, admin bool) gin.H {
	preview := item.PreviewMimeType != nil && *item.PreviewMimeType != "" && item.PreviewSize != nil &&
		*item.PreviewSize != 0
	value := gin.H{"id": item.Id, "title": item.Title, "description": item.Description, "version": item.Version,
		"archiveSize": item.ArchiveSize, "archiveSha256": item.ArchiveSha256, "hasPreview": preview,
		"uploaderId": item.UploaderId, "official": item.Official, "installCount": item.InstallCount,
		"createdAt": iso(item.CreatedAt), "updatedAt": iso(item.UpdatedAt)}
	if admin {
		value["uploaderEmail"] = item.UploaderEmail
		value["archiveFileName"] = item.ArchiveFileName
	}
	return value
}
func (s *service) listSkills(c *gin.Context) {
	items := []SkillMarketItem{}
	err := s.deps.DB.Omit("ArchiveData", "PreviewData").Order(`"createdAt" DESC`).Limit(200).Find(&items).Error
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, presentSkill(item, false))
	}
	platform.Respond(c, gin.H{"items": result}, err)
}
func (s *service) listAdminSkills(c *gin.Context) {
	query := searchQuery(
		c,
		s.deps.DB.Model(&SkillMarketItem{}).Omit("ArchiveData", "PreviewData"),
		[]string{`title`, `description`, `"uploaderEmail"`},
	)
	value, err := paginate[SkillMarketItem](c, query, `"createdAt" DESC`)
	if err == nil {
		items := value["items"].([]SkillMarketItem)
		result := make([]gin.H, 0, len(items))
		for _, item := range items {
			result = append(result, presentSkill(item, true))
		}
		value["items"] = result
	}
	platform.Respond(c, value, err)
}

type skillInput struct {
	Title       string `json:"title"       form:"title"`
	Description string `json:"description" form:"description"`
	Version     string `json:"version"     form:"version"`
}

func bindSkill(c *gin.Context) (skillInput, *uploadedFile, *uploadedFile, error) {
	var input skillInput
	if strings.HasPrefix(c.ContentType(), "multipart/form-data") {
		form, err := c.MultipartForm()
		if err != nil {
			return input, nil, nil, platform.NewError(400, "Bad Request")
		}
		for name, files := range form.File {
			if (name != "archive" && name != "preview") || len(files) > 1 {
				return input, nil, nil, platform.NewError(400, "Unexpected field - "+name)
			}
		}
		if err := c.ShouldBind(&input); err != nil {
			return input, nil, nil, platform.NewError(400, "Bad Request")
		}
		archive, err := readUpload(firstFile(form, "archive"), maxSkillBytes)
		if err != nil {
			return input, nil, nil, err
		}
		preview, err := readUpload(firstFile(form, "preview"), maxSkillBytes)
		return input, archive, preview, err
	}
	err := c.ShouldBindJSON(&input)
	return input, nil, nil, err
}
func firstFile(form *multipart.Form, key string) *multipart.FileHeader {
	if files := form.File[key]; len(files) > 0 {
		return files[0]
	}
	return nil
}
func validateSkillInput(input skillInput) (skillInput, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Version = strings.TrimSpace(input.Version)
	if !versionPattern.MatchString(input.Version) {
		return input, platform.NewError(400, "Skill version contains unsupported characters")
	}
	if input.Title == "" || input.Description == "" {
		return input, platform.NewError(400, "Skill title and description are required")
	}
	return input, nil
}
func (s *service) saveSkill(c *gin.Context) {
	input, archive, preview, err := bindSkill(c)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item, err := s.skillForPublisher(c)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	id := c.Param("id")
	input, err = validateSkillInput(input)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if id != "" && input.Version == item.Version {
		platform.Fail(c, 400, "A new release must use a different version")
		return
	}
	if err = validateSkillFiles(archive, preview, id != ""); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item.Title, item.Description, item.Version = input.Title, input.Description, input.Version
	item.ArchiveFileName = truncateName(archive.Name, "skill.zip")
	item.ArchiveMimeType = "application/zip"
	item.ArchiveSize = int64(len(archive.Data))
	sum := sha256.Sum256(archive.Data)
	item.ArchiveSha256 = hex.EncodeToString(sum[:])
	item.ArchiveData = archive.Data
	if preview != nil {
		item.PreviewMimeType = ptr(preview.MIME)
		item.PreviewSize = ptr(int64(len(preview.Data)))
		item.PreviewData = preview.Data
	}
	err = s.deps.DB.Save(&item).Error
	platform.Respond(c, presentSkill(item, false), err)
}

func (s *service) skillForPublisher(c *gin.Context) (SkillMarketItem, error) {
	actor := platform.User(c)
	item := SkillMarketItem{
		Id: newID(), UploaderId: ptr(actor.ID), UploaderEmail: actor.Email, Official: actor.Role == "admin",
	}
	id := c.Param("id")
	if id == "" {
		return item, nil
	}
	item.Id = id
	if err := s.deps.DB.First(&item, "id = ?", id).Error; err != nil {
		return item, missing(err, "Skill does not exist")
	}
	if item.UploaderId == nil || *item.UploaderId != actor.ID {
		return item, platform.NewError(403, "Only the publisher can modify this skill")
	}
	return item, nil
}

func validateSkillFiles(archive, preview *uploadedFile, newVersion bool) error {
	if archive == nil {
		if newVersion {
			return platform.NewError(400, "A skill archive is required for a new version")
		}
		return platform.NewError(400, "Skill archive is required")
	}
	if err := ValidateSkillArchive(archive.Data); err != nil {
		return err
	}
	if preview != nil {
		return validatePreview(preview)
	}
	return nil
}
func truncateName(name, fallback string) string {
	runes := []rune(name)
	if len(runes) > 255 {
		name = string(runes[:255])
	}
	if name == "" {
		return fallback
	}
	return name
}
func (s *service) previewSkill(c *gin.Context) {
	var item SkillMarketItem
	err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error
	if err != nil {
		platform.Respond(c, nil, missing(err, "Skill preview does not exist"))
		return
	}
	if item.PreviewData == nil || item.PreviewMimeType == nil || *item.PreviewMimeType == "" {
		platform.Fail(c, 404, "Skill preview does not exist")
		return
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.Data(200, *item.PreviewMimeType, item.PreviewData)
}
func (s *service) downloadSkill(c *gin.Context) {
	var item SkillMarketItem
	err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error
	if err != nil {
		platform.Respond(c, nil, missing(err, "Skill does not exist"))
		return
	}
	if item.ArchiveData == nil {
		platform.Fail(c, 404, "Skill does not exist")
		return
	}
	if err = s.deps.DB.Model(&SkillMarketItem{}).Where("id = ?", item.Id).
		Update("installCount", gorm.Expr(`"installCount" + 1`)).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	safeName := strings.NewReplacer("\r", "_", "\n", "_", "\"", "_").Replace(item.ArchiveFileName)
	c.Header("Content-Disposition", `attachment; filename="`+safeName+`"`)
	c.Header("X-Skill-SHA256", item.ArchiveSha256)
	c.Header("Cache-Control", "private, no-store")
	c.Data(200, "application/zip", item.ArchiveData)
}

type skillPatch struct{ Title, Description, Version *string }

func (s *service) adminUpdateSkill(c *gin.Context) {
	var patch skillPatch
	if !bind(c, &patch) {
		return
	}
	var item SkillMarketItem
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Skill does not exist"))
		return
	}
	// ES2022 DTO class fields are enumerable even when absent from the request.
	for _, field := range []string{"title", "description", "version"} {
		if value, present := platform.Body(c)[field]; present && value == nil {
			platform.Respond(c, nil, errors.New("legacy null skill field"))
			return
		}
	}
	if c.GetBool("bodyIsArray") {
		platform.Fail(c, 400, "At least one skill field is required")
		return
	}
	if err := applySkillPatch(&item, patch); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	err := s.deps.DB.Save(&item).Error
	if err == nil {
		err = audit(s.deps.DB, platform.User(c), auditOptions{
			Action: "skill.update", TargetType: "skill", TargetID: item.Id,
			TargetEmail: ptr(item.UploaderEmail), Metadata: gin.H{"fields": []string{"title", "description", "version"}},
		})
	}
	platform.Respond(c, presentSkill(item, true), err)
}

func applySkillPatch(item *SkillMarketItem, patch skillPatch) error {
	for _, field := range []struct {
		name   string
		source *string
		target *string
	}{
		{"title", patch.Title, &item.Title},
		{"description", patch.Description, &item.Description},
		{"version", patch.Version, &item.Version},
	} {
		if field.source == nil {
			continue
		}
		*field.target = strings.TrimSpace(*field.source)
		if *field.target == "" && field.name != "version" {
			return platform.NewError(400, "Skill "+field.name+" is required")
		}
	}
	if patch.Version != nil && !versionPattern.MatchString(item.Version) {
		return platform.NewError(400, "Skill version contains unsupported characters")
	}
	return nil
}
func (s *service) deleteSkill(c *gin.Context) {
	var item SkillMarketItem
	if err := s.deps.DB.First(&item, "id = ?", c.Param("id")).Error; err != nil {
		platform.Respond(c, nil, missing(err, "Skill does not exist"))
		return
	}
	err := s.deps.DB.Delete(&item).Error
	if err == nil {
		err = audit(
			s.deps.DB,
			platform.User(c),
			auditOptions{
				Action:      "skill.delete",
				TargetType:  "skill",
				TargetID:    item.Id,
				TargetEmail: ptr(item.UploaderEmail),
				Metadata: gin.H{
					"title":        item.Title,
					"version":      item.Version,
					"uploaderId":   item.UploaderId,
					"installCount": item.InstallCount,
				},
			},
		)
	}
	platform.Respond(c, ok(), err)
}
