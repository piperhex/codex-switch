//go:build integration

package devices

import (
	"encoding/json"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// Only the fixed local parity database can be used. Fixture rows are rolled back.
func TestServiceCredentialLifecycle(t *testing.T) {
	db, err := gorm.Open(postgres.Open("host=127.0.0.1 port=15432 user=parity password=local-parity-only dbname=admin_go sslmode=disable"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	migration, err := os.ReadFile("../migrations/008_desktop_service.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err = tx.Exec(string(migration)).Error; err != nil {
		t.Fatal(err)
	}
	owner, device := uuid.NewString(), uuid.NewString()
	if err = tx.Exec(`INSERT INTO users(id,email,"passwordHash") VALUES(?,?,?)`, owner, owner+"@example.test", "fixture-only").Error; err != nil {
		t.Fatal(err)
	}
	if err = tx.Exec(`INSERT INTO remote_devices("ownerId","deviceId",name,platform) VALUES(?,?,?,?)`, owner, device, "Fixture", "Windows").Error; err != nil {
		t.Fatal(err)
	}
	deps := &platform.Dependencies{DB: tx, Config: platform.Config{"DESKTOP_SERVICE_ENABLED": "true"}}
	gateway := newControlGateway(&Service{deps})
	closed := 0
	gateway.revokeDesktopService = func(who, id string) {
		if who != owner || id != device {
			t.Error("wrong binding")
		}
		closed++
	}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("principal", &platform.Principal{ID: owner}) })
	router.POST("/devices/:deviceId/service-credential", gateway.createServiceCredential)
	router.DELETE("/devices/:deviceId/service-credential", gateway.revokeServiceCredential)
	router.DELETE("/devices/:deviceId", gateway.remove)
	router.POST("/desktop-service/revoke", gateway.selfRevokeServiceCredential)
	issue := func() string {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/devices/"+device+"/service-credential", nil))
		if response.Code != 201 {
			t.Fatalf("issue status %d", response.Code)
		}
		var body struct {
			Credential string `json:"credential"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Credential
	}
	first := issue()
	who, expiry, err := gateway.service.deviceIdentity(first, device)
	if err != nil || who != owner || time.Until(expiry) > time.Hour {
		t.Fatal("valid host binding rejected", err)
	}
	if _, _, err = gateway.service.deviceIdentity(first, uuid.NewString()); err == nil {
		t.Fatal("cross-device credential accepted")
	}
	second := issue()
	if first == second {
		t.Fatal("credential did not rotate")
	}
	if _, _, err = gateway.service.deviceIdentity(first, device); err == nil {
		t.Fatal("rotated credential accepted")
	}
	request := httptest.NewRequest("POST", "/desktop-service/revoke", nil)
	request.Header.Set("Authorization", "Bearer "+second)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 204 || closed != 3 {
		t.Fatal("credential revocation did not disconnect host", response.Code, closed)
	}
	if _, _, err = gateway.service.deviceIdentity(second, device); err == nil {
		t.Fatal("revoked credential accepted")
	}
	third := issue()
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("DELETE", "/devices/"+device, nil))
	if response.Code != 204 {
		t.Fatal("device deletion failed", response.Code)
	}
	var count int64
	if err = tx.Model(&serviceCredential{}).Where("digest = ?", serviceDigest(third)).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("deleted device retained unattended access", err)
	}
}
