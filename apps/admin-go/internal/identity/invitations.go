package identity

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *service) invitationToken(id string) string {
	mac := hmac.New(sha256.New, []byte(s.secret()))
	mac.Write([]byte("admin-invitation:" + id))
	return id + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *service) signedInvitationID(token string) string {
	id, _, found := strings.Cut(token, ".")
	if !found || id == "" {
		return ""
	}
	if hmac.Equal([]byte(token), []byte(s.invitationToken(id))) {
		return id
	}
	return ""
}
func (s *service) validateInvitation(db *gorm.DB, token, email string) (*invitation, error) {
	query := db.Clauses(clause.Locking{Strength: "UPDATE"}).Where(`"revokedAt" IS NULL`)
	if id := s.signedInvitationID(token); id != "" {
		query = query.Where("id = ?", id)
	} else {
		query = query.Where(`"tokenHash" = ?`, hash(token))
	}
	row := &invitation{}
	err := query.First(row).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	invalid := err != nil || row.ExpiresAt != nil && !row.ExpiresAt.After(now()) ||
		row.Email != nil && *row.Email != normalizedEmail(email) ||
		row.UsedCount >= row.MaxUses
	if invalid {
		return nil, platform.NewError(400, "Invitation is invalid or expired")
	}
	return row, nil
}
func acceptInvitation(db *gorm.DB, row *invitation, u *user) error {
	if row.UsedCount >= row.MaxUses {
		return platform.NewError(400, "Invitation has no remaining uses")
	}
	row.UsedCount++
	accepted := now()
	row.AcceptedAt = &accepted
	row.AcceptedByID = &u.ID
	if err := db.Save(row).Error; err != nil {
		return err
	}
	return db.Create(
		&auditLog{ActorID: &u.ID, ActorEmail: u.Email, Action: "invitation.accept", TargetType: "invitation",
			TargetID: &row.ID, TargetEmail: row.Email,
			Metadata: gin.H{"role": row.Role, "usedCount": row.UsedCount, "maxUses": row.MaxUses}},
	).Error
}
func (s *service) listInvitations(c *gin.Context) (interface{}, error) {
	return paginated[invitation](s.deps.DB.Model(&invitation{}), c)
}
func (s *service) createInvitation(c *gin.Context) (interface{}, error) {
	var request struct {
		Email          string   `json:"email"`
		Role           string   `json:"role"`
		MaxUses        *int     `json:"maxUses"`
		NeverExpires   bool     `json:"neverExpires"`
		ExpiresInHours *float64 `json:"expiresInHours"`
	}
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	actor := platform.User(c)
	code := orDefault(request.Role, "user")
	if err := s.assignable(actor, code); err != nil {
		return nil, err
	}
	row := invitation{ID: uuid.NewString(), Role: code, CreatedByID: actor.ID, CreatedByEmail: actor.Email, MaxUses: 1}
	if request.MaxUses != nil {
		row.MaxUses = *request.MaxUses
	}
	if email := normalizedEmail(request.Email); email != "" {
		row.Email = &email
	}
	if !request.NeverExpires {
		hours := 72.0
		if request.ExpiresInHours != nil {
			hours = *request.ExpiresInHours
		}
		expires := now().Add(time.Duration(hours * float64(time.Hour)))
		row.ExpiresAt = &expires
	}
	token := s.invitationToken(row.ID)
	row.TokenHash = hash(token)
	if err := s.deps.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	err := s.record(
		actor,
		auditLog{Action: "invitation.create", TargetType: "invitation", TargetID: &row.ID, TargetEmail: row.Email,
			Metadata: gin.H{"role": row.Role, "expiresAt": row.ExpiresAt, "maxUses": row.MaxUses}},
	)
	view := platform.JSONValue(row).(platform.JSON)
	view["token"] = token
	return view, err
}
func (s *service) getInvitationToken(c *gin.Context) (interface{}, error) {
	var row invitation
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Invitation not found")
	}
	return gin.H{"token": s.invitationToken(row.ID)}, nil
}
func (s *service) revokeInvitation(c *gin.Context) (interface{}, error) {
	var row invitation
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Invitation not found")
	}
	revoked := now()
	row.RevokedAt = &revoked
	if err := s.deps.DB.Save(&row).Error; err != nil {
		return nil, err
	}
	return row, s.record(
		platform.User(c),
		auditLog{Action: "invitation.revoke", TargetType: "invitation", TargetID: &row.ID, TargetEmail: row.Email},
	)
}
func (s *service) listInvitationUsers(c *gin.Context) (interface{}, error) {
	var row invitation
	if err := s.deps.DB.First(&row, "id = ?", c.Param("id")).Error; err != nil {
		return nil, dbNotFound(err, "Invitation not found")
	}
	db := s.deps.DB.Model(&auditLog{}).
		Where(`action = ? AND "targetType" = ? AND "targetId" = ?`, "invitation.accept", "invitation", row.ID)
	page, size := pages(c)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}
	acceptances := []auditLog{}
	if err := db.Order(`"createdAt" DESC`).Offset((page - 1) * size).Limit(size).Find(&acceptances).Error; err != nil {
		return nil, err
	}
	items := []gin.H{}
	for _, acceptance := range acceptances {
		var count int64
		if acceptance.ActorID != nil {
			err := s.deps.DB.Table("system_account_bindings").
				Where(`"userId" = ?`, *acceptance.ActorID).Count(&count).Error
			if err != nil {
				return nil, err
			}
		}
		roleCode := row.Role
		if code, yes := acceptance.Metadata["role"].(string); yes {
			roleCode = code
		}
		items = append(
			items,
			gin.H{"id": acceptance.ID, "userId": acceptance.ActorID, "email": acceptance.ActorEmail, "role": roleCode,
				"giftedAccountCount": count, "registeredAt": acceptance.CreatedAt},
		)
	}
	return gin.H{"items": items, "total": total, "page": page, "pageSize": size}, nil
}
