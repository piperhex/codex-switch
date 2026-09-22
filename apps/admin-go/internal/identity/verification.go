package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const verificationLifetime = 5 * time.Minute
const resendCooldown = time.Minute
const wrongCodeScript = `local attempts = redis.call('INCR', KEYS[2])
if attempts == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
if attempts >= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1], KEYS[2]) end
return attempts`
const consumeCodeScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then
redis.call('DEL', KEYS[1], KEYS[2]); return 1 end; return 0`

type verificationCode struct {
	Salt string `json:"salt"`
	Hash string `json:"hash"`
}

func codeKey(email, purpose string) string { return "auth:" + purpose + "-code:" + hash(email) }
func invalidCode() error                   { return platform.NewError(400, "Verification code is invalid or expired") }
func (s *service) verifyCode(c *gin.Context, request authRequest, purpose string) error {
	email := normalizedEmail(request.Email)
	key := codeKey(email, purpose)
	ctx := c.Request.Context()
	serialized, err := s.deps.Redis.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return invalidCode()
	}
	if err != nil {
		return err
	}
	var stored verificationCode
	if json.Unmarshal([]byte(serialized), &stored) != nil {
		if err = s.deps.Redis.Del(ctx, key).Err(); err != nil {
			return err
		}
		return invalidCode()
	}
	actual, _ := hex.DecodeString(hash(email + ":" + request.VerificationCode + ":" + stored.Salt))
	expected, _ := hex.DecodeString(stored.Hash)
	if subtle.ConstantTimeCompare(actual, expected) != 1 {
		if err = s.deps.Redis.Eval(ctx, wrongCodeScript, []string{key, key + ":attempts"}, 300, 5).Err(); err != nil {
			return err
		}
		return invalidCode()
	}
	consumed, err := s.deps.Redis.Eval(ctx, consumeCodeScript, []string{key, key + ":attempts"}, serialized).Int()
	if err != nil {
		return err
	}
	if consumed != 1 {
		return invalidCode()
	}
	return nil
}
func (s *service) sendCode(c *gin.Context, email, purpose string) (interface{}, error) {
	if !s.defaultMailConfigured() {
		return nil, platform.NewError(503, "Email service is not configured")
	}
	email = normalizedEmail(email)
	key := codeKey(email, purpose)
	ctx := c.Request.Context()
	acquired, err := s.deps.Redis.SetNX(ctx, key+":cooldown", "1", resendCooldown).Result()
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, platform.NewError(429, "Please wait before requesting another verification code")
	}
	integer, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("%06d", integer.Int64())
	saltBytes := make([]byte, 16)
	if _, err = rand.Read(saltBytes); err != nil {
		return nil, err
	}
	salt := hex.EncodeToString(saltBytes)
	serialized, err := json.Marshal(verificationCode{salt, hash(email + ":" + code + ":" + salt)})
	if err != nil {
		return nil, err
	}
	if err = s.deps.Redis.Del(ctx, key+":attempts").Err(); err != nil {
		return nil, err
	}
	if err = s.deps.Redis.Set(ctx, key, serialized, verificationLifetime).Err(); err != nil {
		return nil, err
	}
	message := verificationMessage(code, purpose, now())
	message.To = email
	if err = SendMail(s.deps, message); err != nil {
		if err = s.deps.Redis.Del(ctx, key, key+":cooldown", key+":attempts").Err(); err != nil {
			return nil, err
		}
		return nil, platform.NewError(503, "Verification email could not be sent")
	}
	return gin.H{"ok": true, "expiresInSeconds": 300}, nil
}
