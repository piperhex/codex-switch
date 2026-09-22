package identity

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strings"
)

func (s *service) registerGovernance(router *gin.Engine) {
	g := router.Group("/admin/api")
	g.GET("/audit-logs", s.deps.RequirePermissions("admin.audit-logs.read"), handle(s.listAuditLogs))
	g.GET("/invitations", s.deps.RequirePermissions("admin.invitations.read"), handle(s.listInvitations))
	g.GET("/invitations/:id/users", s.deps.RequirePermissions("admin.invitations.read"), handle(s.listInvitationUsers))
	g.POST("/invitations", s.deps.RequirePermissions("admin.invitations.manage"), handle(s.createInvitation))
	g.POST(
		"/invitations/:id/token",
		s.deps.RequirePermissions("admin.invitations.manage"),
		handle(s.getInvitationToken),
	)
	g.DELETE("/invitations/:id", s.deps.RequirePermissions("admin.invitations.manage"), handle(s.revokeInvitation))
	g.GET("/approvals", s.deps.RequirePermissions("admin.approvals.read"), handle(s.listApprovals))
	g.POST("/approvals", s.deps.RequirePermissions("admin.approvals.manage"), handle(s.createApproval))
	g.POST("/approvals/:id/review", s.deps.RequirePermissions("admin.approvals.manage"), handle(s.reviewApproval))
}
func (s *service) listAuditLogs(c *gin.Context) (interface{}, error) {
	db := s.deps.DB.Model(&auditLog{})
	if action := c.Query("action"); action != "" {
		db = db.Where("action = ?", action)
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		pattern := "%" + search + "%"
		db = db.Where(`("actorEmail" ILIKE ? OR "targetEmail" ILIKE ? OR action ILIKE ?)`, pattern, pattern, pattern)
	}
	return paginated[auditLog](db, c)
}
func (s *service) listApprovals(c *gin.Context) (interface{}, error) {
	return paginated[approval](s.deps.DB.Model(&approval{}), c)
}
func (s *service) createApproval(c *gin.Context) (interface{}, error) {
	var request struct {
		Type         string `json:"type"`
		TargetUserID string `json:"targetUserId"`
		Comment      string `json:"comment"`
	}
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	target, err := findUser(s.deps.DB, request.TargetUserID)
	if err != nil {
		return nil, err
	}
	if target.Role == "admin" {
		return nil, platform.NewError(400, "User is already an admin")
	}
	actor := platform.User(c)
	row := approval{
		ID:               uuid.NewString(),
		Type:             request.Type,
		Status:           "pending",
		RequestedByID:    actor.ID,
		RequestedByEmail: actor.Email,
		TargetUserID:     target.ID,
		TargetEmail:      target.Email,
		Payload:          gin.H{"role": "admin"},
		Comment:          request.Comment,
	}
	if err = s.deps.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	return row, s.record(
		actor,
		auditLog{Action: "approval.request", TargetType: "approval", TargetID: &row.ID, TargetEmail: &target.Email,
			Metadata: gin.H{"type": row.Type, "targetUserId": target.ID}},
	)
}
func (s *service) reviewApproval(c *gin.Context) (interface{}, error) {
	var request struct {
		Decision string `json:"decision"`
		Comment  string `json:"comment"`
	}
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	var row approval
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Approval request not found")
	}
	if row.Status != "pending" {
		return nil, platform.NewError(400, "Approval request is already closed")
	}
	actor := platform.User(c)
	if row.RequestedByID == actor.ID {
		return nil, platform.NewError(400, "A different admin must review this request")
	}
	if request.Decision == "approved" && row.Type == "promote_user_to_admin" {
		if err := s.assignable(actor, "admin"); err != nil {
			return nil, err
		}
		if _, err := s.patchUser(row.TargetUserID, userPatch{Role: ptr("admin")}); err != nil {
			return nil, err
		}
	}
	reviewed := now()
	row.Status = request.Decision
	row.ReviewedByID = &actor.ID
	row.ReviewedByEmail = &actor.Email
	row.ReviewComment = request.Comment
	row.ReviewedAt = &reviewed
	if err := s.deps.DB.Save(&row).Error; err != nil {
		return nil, err
	}
	return row, s.record(
		actor,
		auditLog{
			Action:      "approval." + request.Decision,
			TargetType:  "approval",
			TargetID:    &row.ID,
			TargetEmail: &row.TargetEmail,
			Metadata:    gin.H{"type": row.Type, "targetUserId": row.TargetUserID},
		},
	)
}
