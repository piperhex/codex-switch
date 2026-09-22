package accounts

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"github.com/codex-switch/admin-go/internal/platform"
	"net/url"
	"strings"
	"time"
)

const embeddedRedirect = "http://localhost:1455/auth/callback"

func (s *service) embeddedStart(actor *platform.Principal) (interface{}, error) {
	id, err := randomValue(32)
	if err != nil {
		return nil, err
	}
	verifier, err := randomValue(64)
	if err != nil {
		return nil, err
	}
	state, err := randomValue(32)
	if err != nil {
		return nil, err
	}
	session := object{
		"ownerId":   actor.ID,
		"verifier":  verifier,
		"state":     state,
		"expiresAt": now().Add(10 * time.Minute).UnixMilli(),
		"status":    "pending",
	}
	if err = s.saveSession(string(embeddedOAuth)+":"+id, session, 10*time.Minute); err != nil {
		return nil, err
	}
	return object{
		"sessionId":        id,
		"authorizationUrl": s.embeddedAuthorizationURL(state, verifier),
		"callbackUrl":      embeddedRedirect,
		"expiresIn":        600,
	}, nil
}

func (s *service) embeddedAuthorizationURL(state, verifier string) string {
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"response_type":              {"code"},
		"client_id":                  {s.clientID()},
		"redirect_uri":               {embeddedRedirect},
		"scope":                      {"openid profile email offline_access api.connectors.read api.connectors.invoke"},
		"code_challenge":             {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method":      {"S256"},
		"id_token_add_organizations": {"true"},
		"codex_cli_simplified_flow":  {"true"},
		"state":                      {state},
		"originator":                 {"codex_cli_rs"},
	}
	order := []string{
		"response_type",
		"client_id",
		"redirect_uri",
		"scope",
		"code_challenge",
		"code_challenge_method",
		"id_token_add_organizations",
		"codex_cli_simplified_flow",
		"state",
		"originator",
	}
	parts := make([]string, 0, len(order))
	for _, key := range order {
		parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(query.Get(key)))
	}
	return s.issuer() + "/oauth/authorize?" + strings.Join(parts, "&")
}

func (s *service) embeddedComplete(actor *platform.Principal, id string, callback object) (interface{}, error) {
	session, key, err := s.loadSession(actor, id, embeddedOAuth)
	if err != nil {
		return nil, err
	}
	if result := terminal(session); result != nil {
		return result, nil
	}
	if subtle.ConstantTimeCompare([]byte(str(session["state"])), []byte(str(callback["state"]))) != 1 {
		return nil, platform.NewError(403, "OAuth callback state is invalid")
	}
	if str(callback["error"]) != "" {
		message := "ChatGPT authorization failed"
		if callback["error"] == "access_denied" {
			message = "ChatGPT authorization was cancelled"
		}
		return s.failOAuth(key, session, platform.NewError(400, message), message)
	}
	if strings.TrimSpace(str(callback["code"])) == "" {
		return nil, platform.NewError(400, "OAuth callback code is missing")
	}
	locked, err := s.deps.Redis.SetNX(context.Background(), key+":lock", "1", time.Minute).Result()
	if err != nil {
		return nil, err
	}
	if !locked {
		return object{"status": "pending"}, nil
	}
	defer s.unlock(key)
	auth, err := s.exchangeCode(str(callback["code"]), str(session["verifier"]), embeddedOAuth)
	if err != nil {
		return s.failOAuth(key, session, err, "ChatGPT authorization failed")
	}
	account, err := s.personalFromAuth(actor.ID, auth)
	if err != nil {
		return s.failOAuth(key, session, err, "ChatGPT authorization failed")
	}
	session["status"] = "complete"
	session["account"] = account
	return terminal(session), s.saveSession(key, session, 5*time.Minute)
}
