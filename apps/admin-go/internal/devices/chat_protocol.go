package devices

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

const chatFrameLimit = 48 * 1024
const chatSessionLimit = 4
const directConnectTimeout = 10 * time.Second

type chatIdentity struct {
	owner, device, role string
	expires             time.Time
}
type chatEndpoint struct {
	socket  *peer
	expires time.Time
}
type chatSession struct {
	id              string
	desktop, mobile *peer
	started         time.Time
	relay           bool
}

var identifierPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)
var publicKeyPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var relayPattern = regexp.MustCompile(`^[a-f0-9]+$`)

func identifier(value interface{}) (string, error) {
	text, ok := value.(string)
	if !ok || !identifierPattern.MatchString(text) {
		return "", errors.New("invalid id")
	}
	return text, nil
}

func publicKey(value interface{}) (string, error) {
	text, ok := value.(string)
	if !ok || !publicKeyPattern.MatchString(text) {
		return "", errors.New("invalid key")
	}
	return text, nil
}

func chatSignal(value interface{}) (platform.JSON, error) {
	message, ok := value.(map[string]interface{})
	if !ok || message == nil {
		return nil, errors.New("invalid signal")
	}
	if generation, exists := message["generation"]; exists && !safeNonnegativeInteger(generation) {
		return nil, errors.New("invalid generation")
	}
	if message["kind"] == "key" {
		key, err := publicKey(message["key"])
		return platform.JSON{"kind": "key", "key": key}, err
	}
	if message["kind"] == "sdp" && (message["type"] == "offer" || message["type"] == "answer") {
		if sdp, ok := message["sdp"].(string); ok && javascriptLength(sdp) <= 24000 {
			return message, nil
		}
	}
	if message["kind"] == "ice" && validICE(message) {
		return message, nil
	}
	return nil, errors.New("invalid signal")
}

func safeNonnegativeInteger(value interface{}) bool {
	number, ok := value.(float64)
	return ok && number >= 0 && number <= 9007199254740991 && math.Trunc(number) == number
}

func validICE(message platform.JSON) bool {
	candidate, ok := message["candidate"].(string)
	if !ok || javascriptLength(candidate) > 2048 {
		return false
	}
	mid, exists := message["sdpMid"]
	if !exists {
		return false
	}
	if mid != nil {
		if _, ok := mid.(string); !ok {
			return false
		}
	}
	index, exists := message["sdpMLineIndex"]
	if !exists {
		return false
	}
	if index == nil {
		return true
	}
	number, ok := index.(float64)
	return ok && math.Trunc(number) == number
}

func javascriptLength(value string) int {
	length := 0
	for _, character := range value {
		length++
		if character > 0xffff {
			length++
		}
	}
	return length
}

func desktopTransportVersion(value interface{}) float64 {
	switch version := value.(type) {
	case float64:
		return version
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(version), 64)
		if err == nil {
			return parsed
		}
	case []interface{}:
		if len(version) == 1 {
			return desktopTransportVersion(version[0])
		}
	}
	return math.NaN()
}

func relayPayload(value interface{}) (string, bool) {
	text, ok := value.(string)
	return text, ok && len(text) <= 40000 && relayPattern.MatchString(text)
}
