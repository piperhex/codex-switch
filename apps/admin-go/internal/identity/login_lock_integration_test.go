//go:build integration

package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const loginFixturePassword = "Login-lock-fixture-2026!"

type loginFixture struct {
	service *service
	user    user
	router  *gin.Engine
}

// Fixed local parity dependencies only; these tests cannot target deployment databases.
func newLoginFixture(t *testing.T) loginFixture {
	t.Helper()
	db, err := gorm.Open(postgres.Open("host=127.0.0.1 port=15432 user=parity "+
		"password=local-parity-only dbname=admin_go sslmode=disable"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	migration, err := os.ReadFile("../../sql/20260923-user-login-locks.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(string(migration)).Error; err != nil {
		t.Fatal(err)
	}
	encoded, err := bcrypt.GenerateFromPassword([]byte(loginFixturePassword), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u := user{ID: uuid.NewString(), Email: "login-lock-" + uuid.NewString() + "@example.test",
		PasswordHash: string(encoded), Role: "user"}
	if err = db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Delete(&u).Error; err != nil {
			t.Error(err)
		}
	})
	s := fixtureService()
	s.deps.DB = db
	s.deps.Redis = redis.NewClient(&redis.Options{Addr: "127.0.0.1:16380"})
	t.Cleanup(func() { _ = s.deps.Redis.Close() })
	router := gin.New()
	s.registerAuth(router)
	return loginFixture{s, u, router}
}

func loginRequest(router http.Handler, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func (f loginFixture) login(password string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(authRequest{Email: strings.ToUpper(f.user.Email), Password: password})
	return loginRequest(f.router, string(body))
}

func (f loginFixture) state(t *testing.T) loginLock {
	t.Helper()
	var state loginLock
	if err := f.service.deps.DB.Where("user_id = ?", f.user.ID).Find(&state).Error; err != nil {
		t.Fatal(err)
	}
	return state
}

func (f loginFixture) expire(t *testing.T) {
	t.Helper()
	err := f.service.deps.DB.Model(&loginLock{}).Where("user_id = ?", f.user.ID).
		Update("locked_until", time.Now().Add(-time.Second)).Error
	if err != nil {
		t.Fatal(err)
	}
}

func assertLoginStatus(t *testing.T, response *httptest.ResponseRecorder, status int) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("login status: got %d, want %d: %s", response.Code, status, response.Body)
	}
}

func assertLoginLock(t *testing.T, response *httptest.ResponseRecorder, seconds int) {
	t.Helper()
	assertLoginStatus(t, response, 429)
	remaining, err := strconv.Atoi(response.Header().Get("Retry-After"))
	if err != nil || remaining > seconds || remaining < seconds-2 {
		t.Fatalf("unexpected retry interval %d: %v", remaining, err)
	}
	if strings.Contains(response.Body.String(), "Token") {
		t.Fatal("locked response contains credentials")
	}
}

func TestLoginLockIntegrationThresholdAndDoubling(t *testing.T) {
	f := newLoginFixture(t)
	for attempt := 1; attempt < loginFailureThreshold; attempt++ {
		assertLoginStatus(t, f.login("incorrect"), 401)
	}
	assertLoginLock(t, f.login("incorrect"), 900)
	initial := f.state(t)
	for _, password := range []string{"incorrect", loginFixturePassword} {
		assertLoginLock(t, f.login(password), 900)
		state := f.state(t)
		if state.Failures != 5 || !state.LockedUntil.Equal(*initial.LockedUntil) {
			t.Fatal("attempt during lock changed its history or deadline")
		}
	}
	// A new service instance must observe the same persisted account state.
	other := &service{f.service.deps}
	f.router = gin.New()
	other.registerAuth(f.router)
	assertLoginLock(t, f.login(loginFixturePassword), 900)
	for _, seconds := range []int{1800, 3600, 7200} {
		f.expire(t)
		assertLoginLock(t, f.login("incorrect"), seconds)
	}
	f.expire(t)
	assertLoginStatus(t, f.login(loginFixturePassword), 201)
	if f.state(t).UserID != "" {
		t.Fatal("successful login did not clear history")
	}
	for attempt := 1; attempt < loginFailureThreshold; attempt++ {
		assertLoginStatus(t, f.login("incorrect"), 401)
	}
	assertLoginLock(t, f.login("incorrect"), 900)
}

func TestLoginLockIntegrationSuccessBreaksSequence(t *testing.T) {
	f := newLoginFixture(t)
	for attempt := 0; attempt < 4; attempt++ {
		assertLoginStatus(t, f.login("incorrect"), 401)
	}
	assertLoginStatus(t, f.login(loginFixturePassword), 201)
	assertLoginStatus(t, f.login("incorrect"), 401)
	if state := f.state(t); state.Failures != 1 || state.LockedUntil != nil {
		t.Fatal("success did not start a new error sequence")
	}
}

func TestLoginLockIntegrationConcurrentAttempts(t *testing.T) {
	f := newLoginFixture(t)
	const requests = 12
	responses := make(chan *httptest.ResponseRecorder, requests)
	var tasks sync.WaitGroup
	for index := 0; index < requests; index++ {
		tasks.Add(1)
		go func() {
			defer tasks.Done()
			responses <- f.login("incorrect")
		}()
	}
	tasks.Wait()
	close(responses)
	counts := map[int]int{}
	for response := range responses {
		counts[response.Code]++
	}
	if counts[401] != 4 || counts[429] != requests-4 || f.state(t).Failures != 5 {
		t.Fatalf("concurrent attempts bypassed lock: %v", counts)
	}
}

func TestLoginLockIntegrationFailedIssuanceRollsBack(t *testing.T) {
	f := newLoginFixture(t)
	assertLoginStatus(t, f.login("incorrect"), 401)
	f.service.deps.Config["JWT_ACCESS_EXPIRES"] = "invalid"
	assertLoginStatus(t, f.login(loginFixturePassword), 500)
	if f.state(t).Failures != 1 {
		t.Fatal("failed token issuance cleared failure history")
	}
}

func TestLoginLockIntegrationDisabledAndMissingAccounts(t *testing.T) {
	f := newLoginFixture(t)
	if err := f.service.deps.DB.Model(&f.user).Update("disabled", true).Error; err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 6; attempt++ {
		assertLoginStatus(t, f.login(loginFixturePassword), 401)
	}
	if f.state(t).UserID != "" {
		t.Fatal("disabled account acquired lock history")
	}
	body, _ := json.Marshal(authRequest{Email: uuid.NewString() + "@example.test", Password: "incorrect"})
	assertLoginStatus(t, loginRequest(f.router, string(body)), 401)
}

func TestLoginLockIntegrationPasswordResetClearsLock(t *testing.T) {
	f := newLoginFixture(t)
	for attempt := 0; attempt < 5; attempt++ {
		f.login("incorrect")
	}
	const code = "123456"
	value, err := json.Marshal(verificationCode{Salt: "fixture", Hash: hash(f.user.Email + ":" + code + ":fixture")})
	if err != nil {
		t.Fatal(err)
	}
	key := codeKey(f.user.Email, "password-reset")
	if err = f.service.deps.Redis.Set(t.Context(), key, value, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	const replacement = "Replacement-fixture-2026!"
	body, _ := json.Marshal(authRequest{Email: f.user.Email, VerificationCode: code, NewPassword: replacement})
	request := httptest.NewRequest(http.MethodPost, "/auth/password-reset", strings.NewReader(string(body)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	f.router.ServeHTTP(response, request)
	assertLoginStatus(t, response, 201)
	if f.state(t).UserID != "" {
		t.Fatal("verified password reset did not clear lock history")
	}
	assertLoginStatus(t, f.login(replacement), 201)
}

func TestLoginLockIntegrationAdminPasswordChangeClearsLock(t *testing.T) {
	f := newLoginFixture(t)
	for attempt := 0; attempt < 5; attempt++ {
		f.login("incorrect")
	}
	replacement := "Admin-replacement-fixture-2026!"
	if _, err := f.service.patchUser(f.user.ID, userPatch{Password: &replacement}); err != nil {
		t.Fatal(err)
	}
	assertLoginStatus(t, f.login(replacement), 201)
}

func TestLoginLockIntegrationMigrationPreservesState(t *testing.T) {
	f := newLoginFixture(t)
	assertLoginStatus(t, f.login("incorrect"), 401)
	migration, err := os.ReadFile("../../sql/20260923-user-login-locks.sql")
	if err != nil {
		t.Fatal(err)
	}
	for repeat := 0; repeat < 2; repeat++ {
		if err = f.service.deps.DB.Exec(string(migration)).Error; err != nil {
			t.Fatal(err)
		}
	}
	if f.state(t).Failures != 1 {
		t.Fatal("reapplying migration lost failure history")
	}
}
