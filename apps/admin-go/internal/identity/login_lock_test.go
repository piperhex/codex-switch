package identity

import (
	"errors"
	"math"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func TestLoginLockDuration(t *testing.T) {
	cases := []struct {
		failures int
		want     time.Duration
	}{
		{0, 0}, {1, 0}, {4, 0}, {5, 15 * time.Minute}, {6, 30 * time.Minute},
		{7, time.Hour}, {8, 2 * time.Hour}, {12, 32 * time.Hour},
		{28, initialLoginLock * (1 << 23)}, {29, time.Duration(math.MaxInt64)},
		{math.MaxInt32, time.Duration(math.MaxInt64)},
	}
	for _, test := range cases {
		if got := loginLockDuration(test.failures); got != test.want {
			t.Errorf("%d failures: got %v, want %v", test.failures, got, test.want)
		}
	}
}

func TestLoginLockResponseRoundsUpRemainingTime(t *testing.T) {
	cases := []struct {
		remaining time.Duration
		seconds   string
		message   string
	}{
		{15 * time.Minute, "900", "Too many incorrect sign-in attempts. Please try again in 15 minutes."},
		{time.Minute + time.Millisecond, "61", "Too many incorrect sign-in attempts. Please try again in 2 minutes."},
		{time.Millisecond, "1", "Too many incorrect sign-in attempts. Please try again in 1 minute."},
		{0, "1", "Too many incorrect sign-in attempts. Please try again in 1 minute."},
	}
	for _, test := range cases {
		response := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(response)
		err := loginLockedError(context, test.remaining)
		var public *platform.HTTPError
		if !errors.As(err, &public) || public.Status != 429 || public.Message != test.message {
			t.Errorf("unexpected locked response: %v", err)
		}
		if got := response.Header().Get("Retry-After"); got != test.seconds {
			t.Errorf("retry-after: got %s, want %s", got, test.seconds)
		}
	}
}
