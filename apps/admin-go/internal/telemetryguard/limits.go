// Package telemetryguard bounds anonymous telemetry before it reaches persistent storage.
package telemetryguard

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const (
	requestTimeout = 2 * time.Second
	day            = 24 * time.Hour
)

type limit struct {
	name    string
	maximum int
	window  time.Duration
}

// Guard shares atomic counters through Redis, including across process restarts.
type Guard struct {
	client *redis.Client
	limits map[string]limit
}

// New rejects invalid limits rather than silently disabling protection.
func New(deps *platform.Dependencies) (*Guard, error) {
	defaults := []limit{
		{"GLOBAL_REQUESTS_PER_MINUTE", 2000, time.Minute},
		{"SOURCE_REQUESTS_PER_MINUTE", 120, time.Minute},
		{"DEVICE_REQUESTS_PER_MINUTE", 12, time.Minute},
		{"SOURCE_INSTALLATIONS_PER_HOUR", 30, time.Hour},
		{"SOURCE_INSTALLATIONS_PER_DAY", 100, day},
		{"GLOBAL_INSTALLATIONS_PER_DAY", 1000, day},
	}
	guard := &Guard{client: deps.Redis, limits: make(map[string]limit)}
	for _, entry := range defaults {
		key := "TELEMETRY_" + entry.name
		value, err := strconv.Atoi(deps.Config.Get(key, strconv.Itoa(entry.maximum)))
		if err != nil || value < 1 || value > 1_000_000 {
			return nil, fmt.Errorf("%s must be between 1 and 1000000", key)
		}
		entry.maximum = value
		guard.limits[entry.name] = entry
	}
	return guard, nil
}

type budget struct{ name, identity string }

// CheckDevice limits traffic even when a caller rotates its source address.
func (g *Guard) CheckDevice(ctx context.Context, id string) error {
	return g.check(ctx, []budget{{"DEVICE_REQUESTS_PER_MINUTE", id}})
}

// CheckInstallation is called only when a previously unseen device registers.
func (g *Guard) CheckInstallation(ctx context.Context, source string) error {
	return g.check(ctx, []budget{
		{"SOURCE_INSTALLATIONS_PER_HOUR", source},
		{"SOURCE_INSTALLATIONS_PER_DAY", source},
		{"GLOBAL_INSTALLATIONS_PER_DAY", "all"},
	})
}

func (g *Guard) check(ctx context.Context, budgets []budget) error {
	if g.client == nil {
		return platform.NewError(503, "Please try again later")
	}
	keys := make([]string, 0, len(budgets))
	args := make([]interface{}, 0, len(budgets)*2)
	for _, item := range budgets {
		entry := g.limits[item.name]
		// Raw source addresses and device IDs are not retained in limiter keys.
		digest := sha256.Sum256([]byte(item.identity))
		keys = append(keys, fmt.Sprintf("telemetry:limits:v1:%s:%x", item.name, digest))
		args = append(args, entry.maximum, entry.window.Milliseconds())
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	retry, err := counterScript.Run(ctx, g.client, keys, args...).Int64()
	if err != nil {
		return platform.NewError(503, "Please try again later")
	}
	if retry > 0 {
		return &throttled{seconds: (retry + 999) / 1000}
	}
	return nil
}

// Source groups IPv6 privacy addresses within one /64; IPv4 stays per address.
func Source(c *gin.Context) string {
	address, err := netip.ParseAddr(c.ClientIP())
	if err != nil {
		return "unknown"
	}
	address = address.Unmap()
	if address.Is6() {
		return netip.PrefixFrom(address, 64).Masked().String()
	}
	return address.String()
}

type throttled struct{ seconds int64 }

func (e *throttled) Error() string { return "Too many requests. Please try again later" }

// Respond includes a retry hint without exposing source addresses or internal failures.
func Respond(c *gin.Context, err error) {
	var limited *throttled
	if errors.As(err, &limited) {
		c.Header("Retry-After", strconv.FormatInt(limited.seconds, 10))
		platform.Fail(c, 429, limited.Error())
		return
	}
	platform.Respond(c, nil, err)
}

// All budgets are checked before any is consumed. Expiry and increments are atomic.
var counterScript = redis.NewScript(`
local retry = 0
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[2*i-1]) then
    retry = math.max(retry, redis.call('PTTL', key), 1)
  end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, ARGV[2*i]) end
end
return 0
`)
