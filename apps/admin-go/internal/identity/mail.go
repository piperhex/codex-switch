package identity

import (
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type mailRequest struct {
	Name        *string `json:"name"`
	Host        *string `json:"host"`
	Port        *int    `json:"port"`
	Secure      *bool   `json:"secure"`
	Username    *string `json:"username"`
	Password    *string `json:"password"`
	FromAddress *string `json:"fromAddress"`
	Enabled     *bool   `json:"enabled"`
}

func (s *service) registerMail(router *gin.Engine) {
	group := router.Group("/admin/api/mail-services")
	group.GET("", s.deps.RequirePermissions("admin.mail-services.read"), handle(s.listMail))
	group.POST("", s.deps.RequirePermissions("admin.mail-services.manage"), handle(s.createMail))
	group.PATCH("/:id", s.deps.RequirePermissions("admin.mail-services.manage"), handle(s.updateMail))
	group.DELETE("/:id", s.deps.RequirePermissions("admin.mail-services.manage"), handle(s.deleteMail))
}
func presentMail(row mailService) gin.H {
	return gin.H{
		"id":             row.ID,
		"source":         "custom",
		"name":           row.Name,
		"host":           row.Host,
		"port":           row.Port,
		"secure":         row.Secure,
		"username":       row.Username,
		"fromAddress":    row.FromAddress,
		"enabled":        row.Enabled,
		"hasPassword":    true,
		"updatedByEmail": nullIfEmpty(row.UpdatedByEmail),
		"updatedAt":      row.UpdatedAt,
	}
}
func nullIfEmpty(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}
func (s *service) listMail(*gin.Context) (interface{}, error) {
	options := s.defaultSMTP()
	result := []gin.H{{"id": nil, "source": "default", "name": "环境变量默认服务", "host": options.Host, "port": options.Port,
		"secure": options.Secure, "username": options.Username,
		"fromAddress": options.From, "enabled": s.defaultMailConfigured(),
		"hasPassword": options.Password != "", "updatedByEmail": nil, "updatedAt": nil}}
	rows := []mailService{}
	if err := s.deps.DB.Order(`"createdAt" ASC`).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result = append(result, presentMail(row))
	}
	return result, nil
}
func (s *service) uniqueMailName(name, excludeID string) error {
	var count int64
	err := s.deps.DB.Model(&mailService{}).
		Where("name ILIKE ? AND id <> ?", strings.TrimSpace(name), excludeID).
		Count(&count).
		Error
	if err != nil {
		return err
	}
	if count > 0 {
		return platform.NewError(409, "Mail service name already exists")
	}
	return nil
}
func (s *service) applyMailRequest(row *mailService, request mailRequest) error {
	if request.Name != nil {
		row.Name = strings.TrimSpace(*request.Name)
	}
	if request.Host != nil {
		row.Host = strings.TrimSpace(*request.Host)
	}
	if request.Port != nil {
		row.Port = *request.Port
	}
	if request.Secure != nil {
		row.Secure = *request.Secure
	}
	if request.Username != nil {
		row.Username = strings.TrimSpace(*request.Username)
	}
	if request.Password != nil {
		encoded, err := s.encryptMailPassword(*request.Password)
		if err != nil {
			return err
		}
		row.EncryptedPassword = encoded
	}
	if request.FromAddress != nil {
		row.FromAddress = strings.TrimSpace(*request.FromAddress)
	}
	if request.Enabled != nil {
		row.Enabled = *request.Enabled
	}
	return nil
}
func (s *service) createMail(c *gin.Context) (interface{}, error) {
	var request mailRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	actor := platform.User(c)
	row := mailService{
		ID:             uuid.NewString(),
		CreatedByID:    &actor.ID,
		CreatedByEmail: actor.Email,
		UpdatedByID:    &actor.ID,
		UpdatedByEmail: actor.Email,
	}
	if err := s.applyMailRequest(&row, request); err != nil {
		return nil, err
	}
	if err := s.uniqueMailName(row.Name, row.ID); err != nil {
		return nil, err
	}
	if err := s.deps.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	return presentMail(
			row,
		), s.record(
			actor,
			auditLog{
				Action:     "mail-service.create",
				TargetType: "mail-service",
				TargetID:   &row.ID,
				Metadata:   gin.H{"name": row.Name},
			},
		)
}
func (s *service) updateMail(c *gin.Context) (interface{}, error) {
	var request mailRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	err := rejectNullFields(c, "name", "host", "port", "secure", "username", "password", "fromAddress", "enabled")
	if err != nil {
		return nil, err
	}
	var row mailService
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Mail service does not exist")
	}
	if request.Name != nil {
		if strings.EqualFold(strings.TrimSpace(*request.Name), row.Name) {
			request.Name = nil
		} else if err := s.uniqueMailName(*request.Name, row.ID); err != nil {
			return nil, err
		}
	}
	keys := auditFields(c, "name", "host", "port", "secure", "username", "fromAddress", "enabled")
	if err := s.applyMailRequest(&row, request); err != nil {
		return nil, err
	}
	actor := platform.User(c)
	row.UpdatedByID = &actor.ID
	row.UpdatedByEmail = actor.Email
	if err := s.deps.DB.Save(&row).Error; err != nil {
		return nil, err
	}
	return presentMail(
			row,
		), s.record(
			actor,
			auditLog{Action: "mail-service.update", TargetType: "mail-service", TargetID: &row.ID,
				Metadata: gin.H{"name": row.Name, "fields": keys, "passwordChanged": request.Password != nil}},
		)
}
func (s *service) deleteMail(c *gin.Context) (interface{}, error) {
	var row mailService
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Mail service does not exist")
	}
	if err := s.deps.DB.Delete(&row).Error; err != nil {
		return nil, err
	}
	return gin.H{
			"id": row.ID,
		}, s.record(
			platform.User(c),
			auditLog{
				Action:     "mail-service.delete",
				TargetType: "mail-service",
				TargetID:   &row.ID,
				Metadata:   gin.H{"name": row.Name},
			},
		)
}
func (s *service) selectableMail(id *string) error {
	if id == nil || *id == "" {
		return nil
	}
	var row mailService
	if err := s.deps.DB.First(&row, "id = ?", *id).Error; err != nil {
		return dbNotFound(err, "Mail service does not exist")
	}
	if !row.Enabled {
		return platform.NewError(409, "Mail service is disabled")
	}
	return nil
}
