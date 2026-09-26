// Package mediarelay meters authenticated TURN traffic before forwarding it to a private coturn service.
package mediarelay

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pion/stun/v3"
)

var errProtocol = errors.New("invalid media relay frame")
var errAuthentication = errors.New("invalid media relay credentials")

// Credentials are compatible with coturn's TURN REST authentication. The secret never leaves the server.
type Credentials struct {
	Username   string `json:"username"`
	Credential string `json:"credential"`
}

func password(secret, username string) string {
	// TURN REST specifies HMAC-SHA1; this is not a password hash.
	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func Issue(secret, owner string, expires time.Time) Credentials {
	username := strconv.FormatInt(expires.Unix(), 10) + ":" + owner + ":" + uuid.NewString()
	return Credentials{Username: username, Credential: password(secret, username)}
}

func credentialOwner(username string) (string, time.Time, error) {
	parts := strings.Split(username, ":")
	if len(parts) != 3 {
		return "", time.Time{}, errAuthentication
	}
	expires, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return "", time.Time{}, errAuthentication
	}
	if _, err = uuid.Parse(parts[1]); err != nil {
		return "", time.Time{}, errAuthentication
	}
	if _, err = uuid.Parse(parts[2]); err != nil {
		return "", time.Time{}, errAuthentication
	}
	return parts[1], time.Unix(expires, 0), nil
}

func authenticate(message *stun.Message, config Config, established string) (string, error) {
	var username stun.Username
	var realm stun.Realm
	if username.GetFrom(message) != nil || realm.GetFrom(message) != nil || string(realm) != config.Realm {
		return "", errAuthentication
	}
	owner, expires, err := credentialOwner(string(username))
	if err != nil || (established != "" && established != owner) {
		return "", errAuthentication
	}
	// Existing allocations can refresh; expired credentials cannot create a new connection/allocation.
	if (established == "" || message.Type.Method == stun.MethodAllocate) && !expires.After(time.Now()) {
		return "", errAuthentication
	}
	integrity := stun.NewLongTermIntegrity(string(username), config.Realm, password(config.Secret, string(username)))
	if integrity.Check(message) != nil {
		return "", errAuthentication
	}
	return owner, nil
}
