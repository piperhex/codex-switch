// Package chatpush delivers content-free chat alerts through Expo, with a durable retry queue.
package chatpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var tokenPattern = regexp.MustCompile(`^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$`)
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)
var accountPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type subscription struct {
	ID        string `gorm:"primaryKey"`
	OwnerID   string
	Token     string
	Account   string
	ExpiresAt time.Time
}

func (subscription) TableName() string { return "chat_push_subscriptions" }

type event struct {
	DeviceID string `json:"deviceId"`
	ThreadID string `json:"threadId"`
	EventID  string `json:"eventId"`
	Kind     string `json:"kind"`
}

func (value event) valid() bool {
	return idPattern.MatchString(value.DeviceID) && idPattern.MatchString(value.ThreadID) &&
		idPattern.MatchString(value.EventID) && (value.Kind == "completed" || value.Kind == "failed" || value.Kind == "attention")
}

type delivery struct {
	ID             string `gorm:"primaryKey"`
	OwnerID        string
	SubscriptionID string
	DeviceID       string
	ThreadID       string
	EventID        string
	Kind           string
	Receipt        string
	Attempts       int
	NextAt         time.Time
	CreatedAt      time.Time
}

func (delivery) TableName() string { return "chat_push_deliveries" }

type service struct {
	deps     *platform.Dependencies
	client   *http.Client
	endpoint string
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// Register is inert until CHAT_PUSH_ENABLED=true and the explicit SQL migration has been applied.
func Register(router *gin.Engine, deps *platform.Dependencies) func() {
	enabled := deps.Config.Get("CHAT_PUSH_ENABLED", "false") == "true"
	s := &service{deps: deps, client: &http.Client{Timeout: 10 * time.Second}, endpoint: "https://exp.host/--/api/v2/push/"}
	group := router.Group("/chat-push", deps.RequireAuth())
	group.GET("/status", func(c *gin.Context) { c.JSON(200, gin.H{"enabled": enabled}) })
	group.Use(func(c *gin.Context) {
		if !enabled {
			platform.Fail(c, 503, "Chat notifications are not configured")
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	})
	group.POST("/subscription", s.subscribe)
	group.DELETE("/subscription", s.unsubscribe)
	group.POST("/events", s.enqueue)
	if !enabled {
		return func() {}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); s.run(ctx) }()
	return func() { cancel(); <-done }
}

func (s *service) subscribe(c *gin.Context) {
	var input struct {
		Token   string `json:"token"`
		Account string `json:"account"`
	}
	if c.ShouldBindJSON(&input) != nil || !tokenPattern.MatchString(input.Token) || !accountPattern.MatchString(input.Account) {
		platform.Fail(c, 400, "Invalid notification subscription")
		return
	}
	owner := platform.User(c).ID
	var count int64
	err := s.deps.DB.Model(&subscription{}).Where("owner_id = ? AND expires_at > ?", owner, time.Now()).Count(&count).Error
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	tokenID := digest(input.Token)
	if count >= 16 {
		var existing int64
		if s.deps.DB.Model(&subscription{}).Where("id = ? AND owner_id = ?", tokenID, owner).Count(&existing).Error != nil || existing == 0 {
			platform.Fail(c, 429, "Too many notification devices")
			return
		}
	}
	entry := subscription{ID: tokenID, OwnerID: owner, Token: input.Token, Account: input.Account,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour)}
	err = s.deps.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"owner_id", "account", "expires_at"})}).Create(&entry).Error
	platform.Respond(c, gin.H{"enabled": true}, err)
}

func (s *service) unsubscribe(c *gin.Context) {
	var input struct {
		Token string `json:"token"`
	}
	if c.ShouldBindJSON(&input) != nil || !tokenPattern.MatchString(input.Token) {
		platform.Fail(c, 400, "Invalid notification subscription")
		return
	}
	err := s.deps.DB.Where("id = ? AND owner_id = ?", digest(input.Token), platform.User(c).ID).Delete(&subscription{}).Error
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	c.Status(204)
}

func (s *service) enqueue(c *gin.Context) {
	var input event
	if c.ShouldBindJSON(&input) != nil || !input.valid() {
		platform.Fail(c, 400, "Invalid notification")
		return
	}
	owner := platform.User(c).ID
	var owned int64
	if err := s.deps.DB.Table("remote_devices").Where(`"ownerId" = ? AND "deviceId" = ?`, owner, input.DeviceID).
		Count(&owned).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if owned != 1 {
		platform.Fail(c, 404, "Device was not found")
		return
	}
	err := s.queue(owner, input)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	c.Status(204)
}

func (s *service) queue(owner string, input event) error {
	return s.deps.DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&delivery{}).Where("owner_id = ? AND created_at > ?", owner,
			time.Now().Add(-time.Minute)).Count(&count).Error; err != nil {
			return err
		}
		if count >= 960 {
			return platform.NewError(429, "Too many notifications")
		}
		var tokens []subscription
		if err := tx.Where("owner_id = ? AND expires_at > ?", owner, time.Now()).Limit(16).Find(&tokens).Error; err != nil {
			return err
		}
		for _, token := range tokens {
			key := deliveryID(owner, token.ID, input)
			entry := delivery{ID: key, OwnerID: owner, SubscriptionID: token.ID, DeviceID: input.DeviceID,
				ThreadID: input.ThreadID, EventID: input.EventID, Kind: input.Kind, NextAt: time.Now().UTC(), CreatedAt: time.Now().UTC()}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&entry).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func deliveryID(owner, subscriptionID string, input event) string {
	return digest(owner + ":" + subscriptionID + ":" + input.DeviceID + ":" +
		input.ThreadID + ":" + input.Kind + ":" + input.EventID)
}

func (s *service) run(ctx context.Context) {
	timer := time.NewTicker(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.drain(ctx)
		}
	}
}

func (s *service) drain(ctx context.Context) {
	var entries []delivery
	if s.deps.DB.WithContext(ctx).Where("next_at <= ? AND attempts < ?", time.Now(), 8).
		Order("next_at").Limit(32).Find(&entries).Error != nil {
		return
	}
	for _, entry := range entries {
		if ctx.Err() != nil {
			return
		}
		var token subscription
		err := s.deps.DB.WithContext(ctx).Where("id = ? AND owner_id = ? AND expires_at > ?",
			entry.SubscriptionID, entry.OwnerID, time.Now()).First(&token).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s.finish(ctx, entry.ID)
			continue
		}
		if err != nil {
			return
		}
		// Claim before network I/O. A crashed worker can resume after the lease; live workers cannot both send it.
		claimed := s.deps.DB.WithContext(ctx).Model(&delivery{}).Where("id = ? AND next_at = ?", entry.ID, entry.NextAt).
			Updates(map[string]interface{}{"next_at": time.Now().UTC().Add(time.Minute), "attempts": entry.Attempts + 1})
		if claimed.Error != nil || claimed.RowsAffected != 1 {
			continue
		}
		s.deliver(ctx, entry, token)
	}
	// Retain completed IDs for deduplication without retaining notification history indefinitely.
	s.deps.DB.WithContext(ctx).Where("created_at < ?", time.Now().Add(-48*time.Hour)).Delete(&delivery{})
	s.deps.DB.WithContext(ctx).Where("expires_at < ?", time.Now()).Delete(&subscription{})
}

func (s *service) finish(ctx context.Context, id string) {
	s.deps.DB.WithContext(ctx).Model(&delivery{}).Where("id = ?", id).Updates(map[string]interface{}{"attempts": 8})
}
