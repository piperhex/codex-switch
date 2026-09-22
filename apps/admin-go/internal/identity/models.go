package identity

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"time"
)

type Timestamps struct {
	CreatedAt time.Time `gorm:"column:createdAt" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updatedAt" json:"updatedAt"`
}

type user struct {
	ID           string     `gorm:"column:id;primaryKey" json:"id"`
	Email        string     `gorm:"column:email"         json:"email"`
	PasswordHash string     `gorm:"column:passwordHash"  json:"-"`
	Role         string     `gorm:"column:role"          json:"role"`
	Disabled     bool       `gorm:"column:disabled"      json:"disabled"`
	LastLoginAt  *time.Time `gorm:"column:lastLoginAt"   json:"lastLoginAt"`
	Timestamps
}

func (user) TableName() string { return "users" }

type refreshToken struct {
	ID        string     `gorm:"column:id;primaryKey"`
	UserID    string     `gorm:"column:userId"`
	TokenHash string     `gorm:"column:tokenHash"`
	ExpiresAt time.Time  `gorm:"column:expiresAt"`
	RevokedAt *time.Time `gorm:"column:revokedAt"`
	CreatedAt time.Time  `gorm:"column:createdAt"`
}

func (refreshToken) TableName() string { return "refresh_tokens" }

type permission struct {
	Code        string `gorm:"column:code;primaryKey" json:"code"`
	Group       string `gorm:"column:group"           json:"group"`
	Name        string `gorm:"column:name"            json:"name"`
	Description string `gorm:"column:description"     json:"description"`
	System      bool   `gorm:"column:system"          json:"system"`
}

func (permission) TableName() string { return "rbac_permissions" }

type role struct {
	Code        string `gorm:"column:code;primaryKey" json:"code"`
	Name        string `gorm:"column:name"            json:"name"`
	Description string `gorm:"column:description"     json:"description"`
	System      bool   `gorm:"column:system"          json:"system"`
	Timestamps
}

func (role) TableName() string { return "rbac_roles" }

type rolePermission struct {
	RoleCode       string `gorm:"column:roleCode;primaryKey"`
	PermissionCode string `gorm:"column:permissionCode;primaryKey"`
}

func (rolePermission) TableName() string { return "rbac_role_permissions" }

type auditLog struct {
	ID          string                 `gorm:"column:id;primaryKey"            json:"id"`
	ActorID     *string                `gorm:"column:actorId"                  json:"actorId"`
	ActorEmail  string                 `gorm:"column:actorEmail"               json:"actorEmail"`
	Action      string                 `gorm:"column:action"                   json:"action"`
	TargetType  string                 `gorm:"column:targetType"               json:"targetType"`
	TargetID    *string                `gorm:"column:targetId"                 json:"targetId"`
	TargetEmail *string                `gorm:"column:targetEmail"              json:"targetEmail"`
	Metadata    map[string]interface{} `gorm:"column:metadata;serializer:json" json:"metadata"`
	CreatedAt   time.Time              `gorm:"column:createdAt"                json:"createdAt"`
}

func (auditLog) TableName() string { return "admin_audit_logs" }
func (a *auditLog) BeforeCreate(*gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	if a.Metadata == nil {
		a.Metadata = map[string]interface{}{}
	}
	return nil
}

type invitation struct {
	ID             string     `gorm:"column:id;primaryKey"  json:"id"`
	Email          *string    `gorm:"column:email"          json:"email"`
	Role           string     `gorm:"column:role"           json:"role"`
	TokenHash      string     `gorm:"column:tokenHash"      json:"-"`
	CreatedByID    string     `gorm:"column:createdById"    json:"-"`
	CreatedByEmail string     `gorm:"column:createdByEmail" json:"createdByEmail"`
	AcceptedByID   *string    `gorm:"column:acceptedById"   json:"-"`
	MaxUses        int        `gorm:"column:maxUses"        json:"maxUses"`
	UsedCount      int        `gorm:"column:usedCount"      json:"usedCount"`
	ExpiresAt      *time.Time `gorm:"column:expiresAt"      json:"expiresAt"`
	AcceptedAt     *time.Time `gorm:"column:acceptedAt"     json:"acceptedAt"`
	RevokedAt      *time.Time `gorm:"column:revokedAt"      json:"revokedAt"`
	Timestamps
}

func (invitation) TableName() string { return "admin_invitations" }

type approval struct {
	ID               string                 `gorm:"column:id;primaryKey"           json:"id"`
	Type             string                 `gorm:"column:type"                    json:"type"`
	Status           string                 `gorm:"column:status"                  json:"status"`
	RequestedByID    string                 `gorm:"column:requestedById"           json:"requestedById"`
	RequestedByEmail string                 `gorm:"column:requestedByEmail"        json:"requestedByEmail"`
	ReviewedByID     *string                `gorm:"column:reviewedById"            json:"reviewedById"`
	ReviewedByEmail  *string                `gorm:"column:reviewedByEmail"         json:"reviewedByEmail"`
	TargetUserID     string                 `gorm:"column:targetUserId"            json:"targetUserId"`
	TargetEmail      string                 `gorm:"column:targetEmail"             json:"targetEmail"`
	Payload          map[string]interface{} `gorm:"column:payload;serializer:json" json:"payload"`
	Comment          string                 `gorm:"column:comment"                 json:"comment"`
	ReviewComment    string                 `gorm:"column:reviewComment"           json:"reviewComment"`
	ReviewedAt       *time.Time             `gorm:"column:reviewedAt"              json:"reviewedAt"`
	Timestamps
}

func (approval) TableName() string { return "admin_approval_requests" }

type mailService struct {
	ID                string  `gorm:"column:id;primaryKey"`
	Name              string  `gorm:"column:name"`
	Host              string  `gorm:"column:host"`
	Port              int     `gorm:"column:port"`
	Secure            bool    `gorm:"column:secure"`
	Username          string  `gorm:"column:username"`
	EncryptedPassword string  `gorm:"column:encryptedPassword"`
	FromAddress       string  `gorm:"column:fromAddress"`
	Enabled           bool    `gorm:"column:enabled"`
	CreatedByID       *string `gorm:"column:createdById"`
	CreatedByEmail    string  `gorm:"column:createdByEmail"`
	UpdatedByID       *string `gorm:"column:updatedById"`
	UpdatedByEmail    string  `gorm:"column:updatedByEmail"`
	Timestamps
}

func (mailService) TableName() string { return "mail_services" }

type emailTemplate struct {
	Code           string  `gorm:"column:code;primaryKey"`
	Subject        string  `gorm:"column:subject"`
	Body           string  `gorm:"column:body"`
	MailServiceID  *string `gorm:"column:mailServiceId"`
	UpdatedByID    *string `gorm:"column:updatedById"`
	UpdatedByEmail string  `gorm:"column:updatedByEmail"`
	Timestamps
}

func (emailTemplate) TableName() string { return "email_templates" }
