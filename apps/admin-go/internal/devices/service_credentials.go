package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
)

const serviceCredentialPrefix = "csw-desktop-service-"

type serviceCredential struct {
	OwnerID   string `gorm:"primaryKey"`
	DeviceID  string `gorm:"primaryKey"`
	Digest    string
	CreatedAt time.Time
}

func (serviceCredential) TableName() string { return "desktop_service_credentials" }
func serviceDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func isServiceCredential(token string) bool { return strings.HasPrefix(token, serviceCredentialPrefix) }

// Device credentials authorize only a host connection for one existing device. They never authorize HTTP/user APIs.
func (s *Service) deviceIdentity(token, device string) (string, time.Time, error) {
	if !isServiceCredential(token) {
		return socketIdentity(s.deps, token)
	}
	if s.deps.Config.Get("DESKTOP_SERVICE_ENABLED", "false") != "true" ||
		len(token) != len(serviceCredentialPrefix)+64 {
		return "", time.Time{}, errors.New("service unavailable")
	}
	var credential serviceCredential
	err := s.deps.DB.Where("device_id = ? AND digest = ?", device, serviceDigest(token)).First(&credential).Error
	if err != nil {
		return "", time.Time{}, errors.New("invalid service credential")
	}
	var count int64
	if err := s.deps.DB.Table("users").Where("id = ? AND disabled = false", credential.OwnerID).Count(&count).Error; err != nil || count != 1 {
		return "", time.Time{}, errors.New("user unavailable")
	}
	if _, err := s.owned(credential.OwnerID, device); err != nil {
		return "", time.Time{}, err
	}
	return credential.OwnerID, time.Now().Add(time.Hour), nil
}

func (g *ControlGateway) createServiceCredential(c *gin.Context) {
	if g.service.deps.Config.Get("DESKTOP_SERVICE_ENABLED", "false") != "true" {
		platform.Fail(c, 503, "Unattended desktop is not configured")
		return
	}
	owner, id := platform.User(c).ID, c.Param("deviceId")
	if _, err := g.service.owned(owner, id); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		platform.Fail(c, 500, "Could not create service credential")
		return
	}
	token := serviceCredentialPrefix + hex.EncodeToString(secret)
	credential := serviceCredential{OwnerID: owner, DeviceID: id, Digest: serviceDigest(token), CreatedAt: time.Now().UTC()}
	err := g.service.deps.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "owner_id"}, {Name: "device_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"digest", "created_at"})}).Create(&credential).Error
	if err == nil {
		g.closeServiceConnections(owner, id)
	}
	platform.Respond(c, gin.H{"credential": token}, err)
}

func (g *ControlGateway) revokeServiceCredential(c *gin.Context) {
	owner, id := platform.User(c).ID, c.Param("deviceId")
	err := g.service.deps.DB.Where("owner_id = ? AND device_id = ?", owner, id).Delete(&serviceCredential{}).Error
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	g.closeServiceConnections(owner, id)
	c.Status(204)
}
func (g *ControlGateway) selfRevokeServiceCredential(c *gin.Context) {
	token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if !isServiceCredential(token) || len(token) != len(serviceCredentialPrefix)+64 {
		platform.Fail(c, 401, "Invalid service credential")
		return
	}
	var record serviceCredential
	if err := g.service.deps.DB.Where("digest = ?", serviceDigest(token)).First(&record).Error; err != nil {
		platform.Fail(c, 401, "Invalid service credential")
		return
	}
	if err := g.service.deps.DB.Where("digest = ?", serviceDigest(token)).Delete(&serviceCredential{}).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	g.closeServiceConnections(record.OwnerID, record.DeviceID)
	c.Status(204)
}

func (g *ControlGateway) closeServiceConnections(owner, device string) {
	g.mu.Lock()
	if client := g.sockets[owner+":"+device]; client != nil && client.serviceHost.Load() {
		client.close(4001, "Service access revoked")
	}
	g.mu.Unlock()
	if g.revokeDesktopService != nil {
		g.revokeDesktopService(owner, device)
	}
}
