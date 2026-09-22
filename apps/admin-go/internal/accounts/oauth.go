package accounts

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/redis/go-redis/v9"
)

type oauthKind string

const (
	personalOAuth oauthKind = "sync:personal-account-oauth"
	officialOAuth oauthKind = "admin:official-account-oauth"
	embeddedOAuth oauthKind = "sync:personal-account-embedded-oauth"
)

var oauthID = regexp.MustCompile(`^[A-Za-z0-9_-]{40,50}$`)
var embeddedID = regexp.MustCompile(`^[A-Za-z0-9_-]{40,90}$`)

func randomValue(size int) (string, error) {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func (s *service) oauthStart(actor *platform.Principal, kind oauthKind) (interface{}, error) {
	if kind == embeddedOAuth {
		return s.embeddedStart(actor)
	}
	response, err := s.request(
		requestOptionsHTTP{
			URL:    s.issuer() + "/api/accounts/deviceauth/usercode",
			Method: "POST",
			Body:   object{"client_id": s.clientID()},
		},
	)
	if err != nil {
		return nil, platform.NewError(502, "Unable to reach the Codex OAuth service")
	}
	if !response.ok() {
		message := fmt.Sprintf("Unable to start Codex OAuth (HTTP %d)", response.Status)
		if response.Status == 404 {
			message = "Codex device authorization is not enabled for this OAuth server"
		}
		return nil, platform.NewError(502, message)
	}
	payload, err := response.object("Codex OAuth start response")
	if err != nil {
		return nil, err
	}
	device, err := requiredToken(payload, "device_auth_id")
	if err != nil {
		return nil, err
	}
	payload["user_code"] = valueOr(payload["user_code"], payload["usercode"])
	code, err := requiredToken(payload, "user_code")
	if err != nil {
		return nil, err
	}
	return s.startDeviceSession(actor, kind, deviceSessionOptions{
		Device: device, Code: code, Interval: oauthPollInterval(payload["interval"]),
	})
}

func oauthPollInterval(value interface{}) float64 {
	interval := number(value)
	if text, ok := value.(string); ok {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		interval = parsed
		if err != nil {
			interval = 5
		}
	}
	if value == nil {
		interval = 5
	}
	return math.Min(15, math.Max(1, math.Ceil(interval)))
}

type deviceSessionOptions struct {
	Device, Code string
	Interval     float64
}

func (s *service) startDeviceSession(
	actor *platform.Principal, kind oauthKind, options deviceSessionOptions,
) (interface{}, error) {
	id, err := randomValue(32)
	if err != nil {
		return nil, err
	}
	session := object{
		"ownerId":      actor.ID,
		"deviceAuthId": options.Device,
		"userCode":     options.Code,
		"interval":     options.Interval,
		"expiresAt":    now().Add(15 * time.Minute).UnixMilli(),
		"status":       "pending",
	}
	if err = s.saveSession(string(kind)+":"+id, session, 15*time.Minute); err != nil {
		return nil, err
	}
	return object{
		"sessionId":       id,
		"verificationUrl": s.issuer() + "/codex/device",
		"userCode":        options.Code,
		"interval":        options.Interval,
		"expiresIn":       900,
	}, nil
}

func (s *service) saveSession(key string, session object, ttl time.Duration) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	return s.deps.Redis.Set(context.Background(), key, string(raw), ttl).Err()
}

func (s *service) loadSession(actor *platform.Principal, id string, kind oauthKind) (object, string, error) {
	pattern := oauthID
	if kind == embeddedOAuth {
		pattern = embeddedID
	}
	if !pattern.MatchString(id) {
		return nil, "", platform.NewError(404, "OAuth session not found or expired")
	}
	key := string(kind) + ":" + id
	raw, err := s.deps.Redis.Get(context.Background(), key).Result()
	if err == redis.Nil {
		return nil, key, platform.NewError(404, "OAuth session not found or expired")
	}
	if err != nil {
		return nil, key, err
	}
	session := object{}
	if json.Unmarshal([]byte(raw), &session) != nil {
		if kind != embeddedOAuth {
			if e := s.deps.Redis.Del(context.Background(), key).Err(); e != nil {
				return nil, key, e
			}
		}
		return nil, key, platform.NewError(404, "OAuth session is invalid")
	}
	if session["ownerId"] != actor.ID {
		label := "user"
		if kind == officialOAuth {
			label = "administrator"
		}
		return nil, key, platform.NewError(403, "OAuth session belongs to another "+label)
	}
	if (kind == embeddedOAuth || session["status"] == "pending") &&
		number(session["expiresAt"]) <= float64(now().UnixMilli()) {
		if err = s.deps.Redis.Del(context.Background(), key).Err(); err != nil {
			return nil, key, err
		}
		return nil, key, platform.NewError(404, "OAuth session expired")
	}
	return session, key, nil
}

func terminal(session object) object {
	switch session["status"] {
	case "complete":
		return object{"status": "complete", "account": session["account"]}
	case "failed":
		return object{"status": "failed", "message": session["message"]}
	}
	return nil
}

func (s *service) oauthPoll(actor *platform.Principal, id string, kind oauthKind) (interface{}, error) {
	session, key, err := s.loadSession(actor, id, kind)
	if err != nil {
		return nil, err
	}
	if result := terminal(session); result != nil {
		return result, nil
	}
	if kind == embeddedOAuth {
		return object{"status": "pending"}, nil
	}
	locked, err := s.deps.Redis.SetNX(context.Background(), key+":lock", "1", time.Minute).Result()
	if err != nil {
		return nil, err
	}
	if !locked {
		return object{"status": "pending"}, nil
	}
	defer s.unlock(key)
	result, err := s.completeDevice(actor, session, kind)
	if err != nil {
		return s.failOAuth(key, session, err, "Codex OAuth authorization failed")
	}
	if result == nil {
		return object{"status": "pending"}, nil
	}
	session["status"] = "complete"
	session["account"] = result
	return terminal(session), s.saveSession(key, session, 5*time.Minute)
}

func (s *service) unlock(key string) {
	if err := s.deps.Redis.Del(context.Background(), key+":lock").Err(); err != nil {
		slog.Error("OAuth session lock could not be released", "error", err)
	}
}

func (s *service) completeDevice(actor *platform.Principal, session object, kind oauthKind) (object, error) {
	response, err := s.request(
		requestOptionsHTTP{
			URL:    s.issuer() + "/api/accounts/deviceauth/token",
			Method: "POST",
			Body:   object{"device_auth_id": session["deviceAuthId"], "user_code": session["userCode"]},
		},
	)
	if err != nil {
		return nil, platform.NewError(502, "Unable to reach the Codex OAuth service")
	}
	if response.Status == 403 || response.Status == 404 {
		return nil, nil
	}
	if !response.ok() {
		return nil, platform.NewError(502, fmt.Sprintf("Codex OAuth authorization failed (HTTP %d)", response.Status))
	}
	credentials, err := response.object("Codex OAuth authorization response")
	if err != nil {
		return nil, err
	}
	code, err := requiredToken(credentials, "authorization_code")
	if err != nil {
		return nil, err
	}
	verifier, err := requiredToken(credentials, "code_verifier")
	if err != nil {
		return nil, err
	}
	auth, err := s.exchangeCode(code, verifier, kind)
	if err != nil {
		return nil, err
	}
	if kind == officialOAuth {
		return s.createOfficial(actor, object{"auth": auth})
	}
	return s.personalFromAuth(actor.ID, auth)
}

func requiredToken(payload object, key string) (string, error) {
	if strings.TrimSpace(str(payload[key])) == "" {
		return "", platform.NewError(502, "Codex OAuth response is missing "+key)
	}
	return str(payload[key]), nil
}

func (s *service) exchangeCode(code, verifier string, kind oauthKind) (object, error) {
	redirect := s.issuer() + "/deviceauth/callback"
	if kind == embeddedOAuth {
		redirect = embeddedRedirect
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirect},
		"client_id":     {s.clientID()},
		"code_verifier": {verifier},
	}
	response, err := s.request(
		requestOptionsHTTP{URL: s.issuer() + "/oauth/token", Method: "POST", Form: form, Proxy: kind == embeddedOAuth},
	)
	if err != nil {
		return nil, platform.NewError(502, "Unable to reach the Codex OAuth service")
	}
	if !response.ok() {
		return nil, platform.NewError(502, fmt.Sprintf("Codex OAuth token exchange failed (HTTP %d)", response.Status))
	}
	tokens, err := response.object("Codex OAuth token response")
	if err != nil {
		return nil, err
	}
	result := object{}
	for _, key := range []string{"id_token", "access_token", "refresh_token"} {
		value, e := requiredToken(tokens, key)
		if e != nil {
			return nil, e
		}
		result[key] = value
	}
	accountID := obj(decodeClaims(str(result["id_token"]))["https://api.openai.com/auth"])["chatgpt_account_id"]
	if str(accountID) == "" {
		accountID = nil
	}
	result["account_id"] = accountID
	return object{"auth_mode": "chatgpt", "OPENAI_API_KEY": nil, "tokens": result}, nil
}

func (s *service) failOAuth(key string, session object, err error, fallback string) (interface{}, error) {
	message := fallback
	if public, ok := err.(*platform.HTTPError); ok {
		message = public.Message
	}
	session["status"] = "failed"
	session["message"] = message
	return terminal(session), s.saveSession(key, session, 5*time.Minute)
}
