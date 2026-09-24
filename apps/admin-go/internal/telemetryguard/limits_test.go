package telemetryguard

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func testGuard(t *testing.T) *Guard {
	t.Helper()
	address := os.Getenv("TELEMETRY_TEST_REDIS")
	if address == "" {
		t.Skip("set TELEMETRY_TEST_REDIS for isolated Redis integration tests")
	}
	if address != "127.0.0.1:16389" {
		t.Fatal("only the dedicated local telemetry Redis is allowed")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 15})
	if err := client.FlushDB(context.Background()).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := client.FlushDB(context.Background()).Err(); err != nil {
			t.Error(err)
		}
		if err := client.Close(); err != nil {
			t.Error(err)
		}
	})
	guard, err := New(&platform.Dependencies{Redis: client})
	if err != nil {
		t.Fatal(err)
	}
	return guard
}

func TestLimitsRejectInvalidConfiguration(t *testing.T) {
	for _, value := range []string{"0", "-1", "abc", "1.5", "1000001"} {
		_, err := New(&platform.Dependencies{Config: platform.Config{
			"TELEMETRY_SOURCE_REQUESTS_PER_MINUTE": value,
		}})
		if err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}

func TestDeviceBudgetIsAtomicAcrossGuards(t *testing.T) {
	guard := testGuard(t)
	other, err := New(&platform.Dependencies{Redis: guard.client})
	if err != nil {
		t.Fatal(err)
	}
	var allowed, unexpected atomic.Int32
	var workers sync.WaitGroup
	for i := 0; i < 60; i++ {
		workers.Add(1)
		go func(index int) {
			defer workers.Done()
			selected := []*Guard{guard, other}[index%2]
			err := selected.CheckDevice(context.Background(), "same-device")
			var limited *throttled
			if err == nil {
				allowed.Add(1)
			} else if !errors.As(err, &limited) {
				unexpected.Add(1)
			}
		}(i)
	}
	workers.Wait()
	if allowed.Load() != 12 || unexpected.Load() != 0 {
		t.Fatalf("allowed=%d unexpected=%d", allowed.Load(), unexpected.Load())
	}
	if err := guard.CheckDevice(context.Background(), "different-device"); err != nil {
		t.Fatal(err)
	}
}

func TestDeniedSourceDoesNotSpendGlobalBudgetAndCountersExpire(t *testing.T) {
	guard := testGuard(t)
	guard.limits["SOURCE_INSTALLATIONS_PER_HOUR"] = limit{"SOURCE_INSTALLATIONS_PER_HOUR", 1, time.Hour}
	guard.limits["GLOBAL_INSTALLATIONS_PER_DAY"] = limit{"GLOBAL_INSTALLATIONS_PER_DAY", 2, day}
	ctx := context.Background()
	if err := guard.CheckInstallation(ctx, "one"); err != nil {
		t.Fatal(err)
	}
	if err := guard.CheckInstallation(ctx, "one"); err == nil {
		t.Fatal("source limit bypassed")
	}
	if err := guard.CheckInstallation(ctx, "two"); err != nil {
		t.Fatal(err)
	}
	if err := guard.CheckInstallation(ctx, "three"); err == nil {
		t.Fatal("global limit bypassed")
	}
	keys, err := guard.client.Keys(ctx, "telemetry:limits:v1:*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range keys {
		if ttl := guard.client.PTTL(ctx, key).Val(); ttl <= 0 {
			t.Fatalf("unbounded key: %s", key)
		}
		if err := guard.client.PExpire(ctx, key, time.Millisecond).Err(); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := guard.CheckInstallation(ctx, "one"); err != nil {
		t.Fatal(err)
	}
}

func TestIngressRejectsInvalidTrafficBeforeNextHandler(t *testing.T) {
	guard := testGuard(t)
	guard.limits["SOURCE_REQUESTS_PER_MINUTE"] = limit{"SOURCE_REQUESTS_PER_MINUTE", 3, time.Minute}
	router := gin.New()
	if err := router.SetTrustedProxies(nil); err != nil {
		t.Fatal(err)
	}
	router.Use(guard.Ingress())
	router.POST("/telemetry/installations", func(c *gin.Context) { c.Status(204) })
	for index, scenario := range []struct {
		body, encoding string
		status         int
	}{
		{strings.Repeat("x", maxBodyBytes+1), "", 413},
		{"compressed", "gzip", 415},
		{"{}", "", 204},
		{"{}", "", 429},
	} {
		request := httptest.NewRequest("POST", "/telemetry/installations", strings.NewReader(scenario.body))
		request.RemoteAddr = "192.0.2.1:4000"
		request.Header.Set("Content-Encoding", scenario.encoding)
		request.Header.Set("X-Forwarded-For", "198.51.100."+strconv.Itoa(index))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != scenario.status {
			t.Fatalf("%d: %d %s", index, response.Code, response.Body)
		}
		if scenario.status == 429 && response.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry hint")
		}
	}
}

func TestUnavailableLimiterFailsClosed(t *testing.T) {
	guard, err := New(&platform.Dependencies{})
	if err != nil {
		t.Fatal(err)
	}
	err = guard.CheckDevice(context.Background(), "device")
	var public *platform.HTTPError
	if !errors.As(err, &public) || public.Status != 503 {
		t.Fatalf("unexpected failure: %v", err)
	}
}

func TestSourceNormalizesIPv6AndMappedIPv4(t *testing.T) {
	for remote, expected := range map[string]string{
		"[2001:db8:12:34::1]:80":    "2001:db8:12:34::/64",
		"[2001:db8:12:34::ffff]:80": "2001:db8:12:34::/64",
		"[::ffff:192.0.2.4]:80":     "192.0.2.4",
	} {
		router := gin.New()
		if err := router.SetTrustedProxies(nil); err != nil {
			t.Fatal(err)
		}
		router.GET("/", func(c *gin.Context) { c.String(200, Source(c)) })
		request := httptest.NewRequest("GET", "/", nil)
		request.RemoteAddr = remote
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Body.String() != expected {
			t.Fatalf("%s: %s", remote, response.Body)
		}
	}
}
