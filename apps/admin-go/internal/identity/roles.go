package identity

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"strings"
)

type roleRequest struct {
	Code        string    `json:"code"`
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Permissions *[]string `json:"permissions"`
}

func (s *service) createRole(c *gin.Context) (interface{}, error) {
	var request roleRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	code := strings.ToLower(strings.TrimSpace(request.Code))
	var count int64
	if err := s.deps.DB.Model(&role{}).Where("code = ?", code).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(400, "Role code already exists")
	}
	codes := []string{}
	if request.Permissions != nil {
		codes = *request.Permissions
	}
	permissions, err := s.resolvePermissions(codes)
	if err != nil {
		return nil, err
	}
	if err = canGrant(platform.User(c), permissions); err != nil {
		return nil, err
	}
	r := role{Code: code}
	if request.Name != nil {
		r.Name = strings.TrimSpace(*request.Name)
	}
	if request.Description != nil {
		r.Description = strings.TrimSpace(*request.Description)
	}
	if err = s.saveRole(&r, permissions); err != nil {
		return nil, err
	}
	view, err := s.presentRole(r)
	if err != nil {
		return nil, err
	}
	return view, s.record(platform.User(c), auditLog{Action: "role.create", TargetType: "role", TargetID: &r.Code,
		Metadata: gin.H{"name": r.Name, "permissions": view.(gin.H)["permissions"]}})
}
func (s *service) updateRole(c *gin.Context) (interface{}, error) {
	var request roleRequest
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	if err := rejectNullFields(c, "name", "description", "permissions"); err != nil {
		return nil, err
	}
	r, permissions, err := s.getRole(c.Param("code"))
	if err != nil {
		return nil, err
	}
	if r.System && r.Code != "user" {
		return nil, platform.NewError(400, "Only the built-in user role can be modified")
	}
	keys := auditFields(c, "name", "description", "permissions")
	if request.Name != nil {
		r.Name = strings.TrimSpace(*request.Name)
	}
	if request.Description != nil {
		r.Description = strings.TrimSpace(*request.Description)
	}
	if request.Permissions != nil {
		permissions, err = s.resolveRolePatch(platform.User(c), permissions, *request.Permissions)
		if err != nil {
			return nil, err
		}
	}
	if err = s.saveRole(r, permissions); err != nil {
		return nil, err
	}
	view, err := s.presentRole(*r)
	if err != nil {
		return nil, err
	}
	return view, s.record(platform.User(c), auditLog{Action: "role.update", TargetType: "role", TargetID: &r.Code,
		Metadata: gin.H{"fields": keys, "permissions": view.(gin.H)["permissions"]}})
}
func (s *service) resolveRolePatch(actor *platform.Principal, current, requested []string) ([]string, error) {
	permissions, err := s.resolvePermissions(requested)
	if err != nil {
		return nil, err
	}
	existing := map[string]bool{}
	for _, code := range current {
		existing[code] = true
	}
	added := []string{}
	for _, code := range permissions {
		if !existing[code] {
			added = append(added, code)
		}
	}
	return permissions, canGrant(actor, added)
}
func (s *service) deleteRole(c *gin.Context) (interface{}, error) {
	code := c.Param("code")
	r, _, err := s.getRole(code)
	if err != nil {
		return nil, err
	}
	if r.System {
		return nil, platform.NewError(400, "Built-in roles cannot be deleted")
	}
	var count int64
	err = s.deps.DB.Raw(`SELECT (SELECT COUNT(*) FROM users WHERE role = ?) +
 (SELECT COUNT(*) FROM admin_invitations WHERE role = ? AND "revokedAt" IS NULL
 AND "usedCount" < "maxUses" AND ("expiresAt" IS NULL OR "expiresAt" > now()))`, code, code).Scan(&count).Error
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(400, "Role is assigned to a user or active invitation")
	}
	if err = s.deps.DB.Delete(r).Error; err != nil {
		return nil, err
	}
	return gin.H{
			"code": code,
		}, s.record(
			platform.User(c),
			auditLog{Action: "role.delete", TargetType: "role", TargetID: &code},
		)
}
