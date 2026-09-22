package identity

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
)

func (s *service) mailCipher() (cipher.AEAD, error) {
	key := sha256.Sum256([]byte("codex-switch:mail-service:" + s.secret()))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (s *service) encryptMailPassword(password string) (string, error) {
	aead, err := s.mailCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, nonceBytes)
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nil, nonce, []byte(password), nil)
	encode := base64.RawURLEncoding.EncodeToString
	return strings.Join(
		[]string{"v1", encode(nonce), encode(sealed[len(sealed)-tagBytes:]), encode(sealed[:len(sealed)-tagBytes])},
		":",
	), nil
}
func (s *service) decryptMailPassword(value string) (string, error) {
	parts := strings.Split(value, ":")
	if len(parts) < 4 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", platform.NewError(503, "Stored mail service password is invalid")
	}
	invalid := platform.NewError(503, "Stored mail service password could not be decrypted")
	nonce, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(nonce) != nonceBytes {
		return "", invalid
	}
	tag, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", invalid
	}
	encrypted, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return "", invalid
	}
	aead, err := s.mailCipher()
	if err != nil {
		return "", invalid
	}
	plain, err := aead.Open(nil, nonce, append(encrypted, tag...), nil)
	if err != nil {
		return "", invalid
	}
	return string(plain), nil
}
