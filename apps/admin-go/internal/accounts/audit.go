package accounts

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"strings"
	"time"
)

type auditEntry struct {
	ID          string    `gorm:"column:id;primaryKey"`
	ActorID     string    `gorm:"column:actorId"`
	ActorEmail  string    `gorm:"column:actorEmail"`
	Action      string    `gorm:"column:action"`
	TargetType  string    `gorm:"column:targetType"`
	TargetID    *string   `gorm:"column:targetId"`
	TargetEmail *string   `gorm:"column:targetEmail"`
	Metadata    object    `gorm:"column:metadata;serializer:json"`
	CreatedAt   time.Time `gorm:"column:createdAt"`
}

func (auditEntry) TableName() string { return "admin_audit_logs" }

type auditOptions struct {
	Action, TargetID, TargetEmail string
	Metadata                      object
}

func (s *service) record(actor *platform.Principal, options auditOptions) error {
	row := auditEntry{
		ID:         newID(),
		ActorID:    actor.ID,
		ActorEmail: actor.Email,
		Action:     options.Action,
		TargetType: strings.Split(options.Action, ".")[0],
		Metadata:   obj(options.Metadata),
	}
	if options.TargetID != "" {
		row.TargetID = &options.TargetID
	}
	if options.TargetEmail != "" {
		row.TargetEmail = &options.TargetEmail
	}
	return s.deps.DB.Create(&row).Error
}

func (s *service) createOfficial(actor *platform.Principal, in object) (object, error) {
	result, err := s.createSystem(actor, in, nil)
	if err != nil {
		return nil, err
	}
	err = s.record(
		actor,
		auditOptions{
			Action:      "official-account.create",
			TargetID:    str(result["id"]),
			TargetEmail: str(result["email"]),
			Metadata:    object{"syncAccountId": result["syncAccountId"]},
		},
	)
	return result, err
}

type addPersonalOptions struct {
	Owner, ID string
	Own       bool
}

func (s *service) addPersonal(actor *platform.Principal, options addPersonalOptions) (interface{}, error) {
	owner, id := options.Owner, options.ID
	user, err := s.ensureUser(owner)
	if err != nil {
		return nil, err
	}
	row := account{}
	err = s.deps.DB.Where(`"ownerId" = ? AND "accountId" = ? AND "deletedAt" IS NULL`, owner, id).First(&row).Error
	if err != nil {
		return nil, notFound(err, "Synced account not found")
	}
	auth, err := normalizeAuth(row.Auth)
	if err != nil {
		return nil, err
	}
	auth = supplementPersonalAuth(auth, row)
	origin := object{"source": "admin", "sourceAccountId": id}
	action := "official-account.create-from-user"
	metadata := object{"sourceOwnerId": owner, "sourceOwnerEmail": user["email"], "sourceAccountId": id}
	if options.Own {
		origin["source"] = "desktop"
		action = "official-account.create-from-own-account"
		delete(metadata, "sourceOwnerId")
		delete(metadata, "sourceOwnerEmail")
	}
	result, err := s.createSystem(
		actor,
		object{"auth": auth, "note": row.Note, "expiresAt": row.ExpiresAt, "usage": row.Usage},
		origin,
	)
	if err != nil {
		return nil, err
	}
	metadata["syncAccountId"] = result["syncAccountId"]
	return result, s.record(
		actor,
		auditOptions{
			Action:      action,
			TargetID:    str(result["id"]),
			TargetEmail: str(result["email"]),
			Metadata:    metadata,
		},
	)
}

func supplementPersonalAuth(auth object, row account) object {
	tokens := obj(auth["tokens"])
	if len(tokens) == 0 {
		return auth
	}
	tokens = copyObject(tokens)
	if str(tokens["email"]) == "" {
		tokens["email"] = row.Email
	}
	if str(tokens["plan_type"]) == "" {
		tokens["plan_type"] = row.Plan
	}
	if first(tokens["account_id"], tokens["chatgpt_account_id"]) == "" && row.CodexAccountID != nil {
		tokens["account_id"] = *row.CodexAccountID
	}
	result := copyObject(auth)
	result["tokens"] = tokens
	return result
}
