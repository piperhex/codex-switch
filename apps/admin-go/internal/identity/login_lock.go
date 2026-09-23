package identity

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const loginFailureThreshold = 5
const initialLoginLock = 15 * time.Minute

// Kept separate from user so unrelated profile saves cannot overwrite lock state.
type loginLock struct {
	UserID      string     `gorm:"column:user_id;primaryKey"`
	Failures    int        `gorm:"column:failures"`
	LockedUntil *time.Time `gorm:"column:locked_until"`
}

func (loginLock) TableName() string { return "user_login_locks" }

type loginOutcome struct {
	Tokens      gin.H
	Invalid     bool
	LockedUntil *time.Time
}

// Authentication denials are outcomes, not transaction errors: failed attempts must commit.
func (s *service) attemptLogin(tx *gorm.DB, request authRequest) (loginOutcome, error) {
	var u user
	// Serialize password checks, counters and token issuance across all server instances.
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("email = ?", normalizedEmail(request.Email)).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && u.Disabled {
		return loginOutcome{Invalid: true}, nil
	}
	if err != nil {
		return loginOutcome{}, err
	}
	state := loginLock{UserID: u.ID}
	if err = tx.Where("user_id = ?", u.ID).Find(&state).Error; err != nil {
		return loginOutcome{}, err
	}
	at := now()
	if state.LockedUntil != nil && state.LockedUntil.After(at) {
		return loginOutcome{LockedUntil: state.LockedUntil}, nil
	}
	if !passwordMatches(u.PasswordHash, request.Password) {
		return recordLoginFailure(tx, state, at)
	}
	if err = clearLoginLock(tx, u.ID); err != nil {
		return loginOutcome{}, err
	}
	if err = tx.Model(&u).Update("lastLoginAt", at).Error; err != nil {
		return loginOutcome{}, err
	}
	tokens, err := s.issueTokens(tx, &u)
	return loginOutcome{Tokens: tokens}, err
}

func recordLoginFailure(tx *gorm.DB, state loginLock, at time.Time) (loginOutcome, error) {
	if state.Failures < math.MaxInt32 {
		state.Failures++
	}
	if delay := loginLockDuration(state.Failures); delay > 0 {
		until := at.Add(delay)
		state.LockedUntil = &until
	}
	err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&state).Error
	return loginOutcome{Invalid: true, LockedUntil: state.LockedUntil}, err
}

func loginLockDuration(failures int) time.Duration {
	if failures < loginFailureThreshold {
		return 0
	}
	delay := initialLoginLock
	for attempt := loginFailureThreshold; attempt < failures; attempt++ {
		// Saturate only at Go's representable duration limit; doubling must never wrap negative.
		if delay > time.Duration(math.MaxInt64)/2 {
			return time.Duration(math.MaxInt64)
		}
		delay *= 2
	}
	return delay
}

func clearLoginLock(tx *gorm.DB, userID string) error {
	return tx.Where("user_id = ?", userID).Delete(&loginLock{}).Error
}

func loginLockedError(c *gin.Context, remaining time.Duration) error {
	seconds := int64(remaining / time.Second)
	if remaining%time.Second > 0 {
		seconds++
	}
	seconds = max(seconds, 1)
	c.Header("Retry-After", strconv.FormatInt(seconds, 10))
	minutes := (seconds + 59) / 60
	unit := "minutes"
	if minutes == 1 {
		unit = "minute"
	}
	return platform.NewError(429,
		fmt.Sprintf("Too many incorrect sign-in attempts. Please try again in %d %s.", minutes, unit))
}
