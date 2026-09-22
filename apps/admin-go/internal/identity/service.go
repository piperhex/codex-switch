package identity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type service struct{ deps *platform.Dependencies }
type endpoint func(*gin.Context) (interface{}, error)

func handle(fn endpoint) gin.HandlerFunc {
	return func(c *gin.Context) { v, e := fn(c); platform.Respond(c, v, e) }
}
func bind(c *gin.Context, request interface{}) error {
	if err := c.ShouldBindBodyWithJSON(request); err != nil {
		return platform.NewError(400, "Bad Request")
	}
	return nil
}
func rejectNullFields(c *gin.Context, fields ...string) error {
	value, exists := c.Get(gin.BodyBytesKey)
	if !exists {
		return nil
	}
	data, valid := value.([]byte)
	if !valid {
		return nil
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		return err
	}
	for _, field := range fields {
		if string(body[field]) == "null" {
			return errors.New("null value is unsupported by the legacy operation")
		}
	}
	return nil
}
func hash(value string) string {
	bytes := sha256.Sum256([]byte(value))
	return hex.EncodeToString(bytes[:])
}
func normalizedEmail(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
func ptr(value string) *string            { return &value }
func now() time.Time                      { return time.Now().UTC().Truncate(time.Millisecond) }
func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
func ok() interface{} { return gin.H{"ok": true} }
func dbNotFound(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return platform.NewError(404, message)
	}
	return err
}
func (s *service) record(actor *platform.Principal, entry auditLog) error {
	entry.ActorID = &actor.ID
	entry.ActorEmail = actor.Email
	return s.deps.DB.Create(&entry).Error
}
func fields(value map[string]interface{}, except string) []string {
	result := []string{}
	for k := range value {
		if k != except {
			result = append(result, k)
		}
	}
	sort.Strings(result)
	return result
}
func auditFields(c *gin.Context, declared ...string) []string {
	if c.GetBool("bodyIsArray") {
		return []string{}
	}
	return declared
}
func pages(c *gin.Context) (int, int) {
	query := platform.Query(c)
	page := queryInteger(query["page"], 1)
	size := queryInteger(query["pageSize"], 20)
	return max(1, page), min(100, max(1, size))
}
func queryInteger(value interface{}, fallback int) int {
	if value == nil {
		return fallback
	}
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case string:
		parsed, err := strconv.ParseFloat(number, 64)
		if err == nil {
			return int(parsed)
		}
	}
	return fallback
}
func paginated[T interface{}](db *gorm.DB, c *gin.Context) (interface{}, error) {
	page, size := pages(c)
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, err
	}
	items := []T{}
	err := db.Order(`"createdAt" DESC`).Offset((page - 1) * size).Limit(size).Find(&items).Error
	return gin.H{"items": items, "total": total, "page": page, "pageSize": size}, err
}
func (s *service) secret() string {
	return orDefault(strings.TrimSpace(s.deps.Config.Get("KONG_JWT_SECRET", "")), "change-me-kong-jwt-secret")
}
func (s *service) refreshSecret() string {
	return orDefault(strings.TrimSpace(s.deps.Config.Get("JWT_REFRESH_SECRET", "")), "replace-with-refresh-secret")
}

// Register installs the legacy authentication and administration HTTP contracts.
func Register(router *gin.Engine, deps *platform.Dependencies) error {
	s := &service{deps}
	deps.Authenticate = s.authenticate
	s.registerAuth(router)
	s.registerRBAC(router)
	s.registerUsers(router)
	s.registerGovernance(router)
	s.registerMail(router)
	s.registerTemplates(router)
	return nil
}
