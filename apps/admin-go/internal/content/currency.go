package content

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type currencyItem struct {
	Code string `json:"code"`
	Name string `json:"name"`
}
type currencyRate struct {
	Code string  `json:"code"`
	Name string  `json:"name"`
	Rate float64 `json:"rate"`
}
type currencySettings struct {
	Id              string         `gorm:"column:id;primaryKey"`
	EncryptedApiKey *string        `gorm:"column:encrypted_api_key"`
	Currencies      []currencyItem `gorm:"column:currencies;serializer:json"`
	UpdatedById     *string        `gorm:"column:updated_by_id"`
	UpdatedByEmail  string         `gorm:"column:updated_by_email"`
	UpdatedAt       time.Time      `gorm:"column:updated_at;autoUpdateTime"`
}

func (currencySettings) TableName() string { return "currency_settings" }

type currencyCache struct {
	sync.Mutex
	Rates     []currencyRate
	ExpiresAt time.Time
}

func (s *service) currencySetting() (currencySettings, error) {
	item := currencySettings{Id: "current", Currencies: []currencyItem{}}
	err := s.deps.DB.First(&item, "id = ?", "current").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	return item, err
}
func (s *service) presentCurrency(item currencySettings) gin.H {
	s.currency.Lock()
	defer s.currency.Unlock()
	rates := []currencyRate{}
	var expiry interface{}
	if s.currency.ExpiresAt.After(time.Now()) {
		rates = s.currency.Rates
		expiry = iso(s.currency.ExpiresAt)
	}
	return gin.H{"hasApiKey": item.EncryptedApiKey != nil && *item.EncryptedApiKey != "", "currencies": item.Currencies,
		"cachedRates": rates, "cacheExpiresAt": expiry, "updatedAt": dateOrNil(item.UpdatedAt)}
}
func (s *service) adminCurrency(c *gin.Context) {
	item, err := s.currencySetting()
	platform.Respond(c, s.presentCurrency(item), err)
}

var currencyCodePattern = regexp.MustCompile(`^[A-Z]{3}$`)

func normalizeCurrencies(items []currencyItem) ([]currencyItem, error) {
	result := make([]currencyItem, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item.Code, item.Name = strings.ToUpper(strings.TrimSpace(item.Code)), strings.TrimSpace(item.Name)
		if !currencyCodePattern.MatchString(item.Code) || item.Name == "" {
			return nil, platform.NewError(400, "Currency code and name are required")
		}
		if item.Code == "USD" || seen[item.Code] {
			return nil, platform.NewError(400, "Currency codes must be unique and cannot be USD")
		}
		seen[item.Code] = true
		result = append(result, item)
	}
	return result, nil
}

type currencyUpdateInput struct {
	Currencies  []currencyItem
	ApiKey      *string
	ClearApiKey bool
}

func (s *service) updateCurrency(c *gin.Context) {
	var input currencyUpdateInput
	if !bind(c, &input) {
		return
	}
	if value, present := platform.Body(c)["apiKey"]; present && value == nil {
		platform.Respond(c, nil, errors.New("legacy null currency API key"))
		return
	}
	currencies, err := normalizeCurrencies(input.Currencies)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	item, err := s.currencySetting()
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if err = s.applyCurrencyKey(&item, input); err != nil {
		platform.Respond(c, nil, err)
		return
	}
	actor := platform.User(c)
	item.Currencies, item.UpdatedById, item.UpdatedByEmail = currencies, ptr(actor.ID), actor.Email
	if err = s.deps.DB.Save(&item).Error; err != nil {
		platform.Respond(c, nil, err)
		return
	}
	s.currency.Lock()
	s.currency.Rates = nil
	s.currency.ExpiresAt = time.Time{}
	s.currency.Unlock()
	codes := make([]string, 0, len(currencies))
	for _, item := range currencies {
		codes = append(codes, item.Code)
	}
	err = audit(s.deps.DB, actor, auditOptions{
		Action: "currency-settings.update", TargetType: "currency-settings", TargetID: "current",
		Metadata: gin.H{"currencyCodes": codes, "apiKeyChanged": input.ApiKey != nil || input.ClearApiKey},
	})
	result := s.presentCurrency(item)
	// TypeORM's saved result omits the select:false key; GET still reports the persisted key.
	result["hasApiKey"] = false
	platform.Respond(c, result, err)
}

func (s *service) applyCurrencyKey(item *currencySettings, input currencyUpdateInput) error {
	if input.ClearApiKey {
		item.EncryptedApiKey = nil
	}
	if input.ApiKey == nil {
		return nil
	}
	encrypted, err := encryptCurrency(strings.TrimSpace(*input.ApiKey), s.currencyKey())
	if err != nil {
		return err
	}
	item.EncryptedApiKey = &encrypted
	return nil
}
func (s *service) publicCurrencyRates(c *gin.Context) {
	s.currency.Lock()
	rates, expires := s.currency.Rates, s.currency.ExpiresAt
	s.currency.Unlock()
	if expires.After(time.Now()) {
		platform.Respond(c, gin.H{"currencies": rates, "updatedAt": iso(time.Now())}, nil)
		return
	}
	item, err := s.currencySetting()
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	if item.EncryptedApiKey == nil || *item.EncryptedApiKey == "" || len(item.Currencies) == 0 {
		platform.Respond(c, gin.H{"currencies": []currencyRate{}, "updatedAt": dateOrNil(item.UpdatedAt)}, nil)
		return
	}
	key, err := decryptCurrency(*item.EncryptedApiKey, s.currencyKey())
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	rates, err = s.fetchCurrencyRates(key, item.Currencies)
	if err != nil {
		platform.Respond(c, nil, err)
		return
	}
	s.currency.Lock()
	s.currency.Rates = rates
	s.currency.ExpiresAt = time.Now().Add(24 * time.Hour)
	s.currency.Unlock()
	platform.Respond(c, gin.H{"currencies": rates, "updatedAt": dateOrNil(item.UpdatedAt)}, nil)
}
func (s *service) currencyKey() []byte {
	secret := strings.TrimSpace(s.deps.Config.Get("KONG_JWT_SECRET", ""))
	if secret == "" {
		secret = "change-me-kong-jwt-secret"
	}
	sum := sha256.Sum256([]byte("codex-switch:currency-api:" + secret))
	return sum[:]
}
func encryptCurrency(value string, key []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, 12)
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	encrypted := gcm.Seal(nil, nonce, []byte(value), nil)
	data, tag := encrypted[:len(encrypted)-gcm.Overhead()], encrypted[len(encrypted)-gcm.Overhead():]
	encode := base64.RawURLEncoding.EncodeToString
	return strings.Join([]string{"v1", encode(nonce), encode(tag), encode(data)}, ":"), nil
}
func decryptCurrency(value string, key []byte) (string, error) {
	invalid := platform.NewError(503, "Currency API key is invalid")
	parts := strings.Split(value, ":")
	if len(parts) < 4 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", invalid
	}
	decoded := make([][]byte, 3)
	for index := range decoded {
		bytes, err := base64.RawURLEncoding.DecodeString(parts[index+1])
		if err != nil {
			return "", invalid
		}
		decoded[index] = bytes
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", invalid
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", invalid
	}
	if len(decoded[0]) != gcm.NonceSize() || len(decoded[1]) != gcm.Overhead() {
		return "", invalid
	}
	data, err := gcm.Open(nil, decoded[0], append(decoded[2], decoded[1]...), nil)
	if err != nil {
		return "", invalid
	}
	return string(data), nil
}
func (s *service) fetchCurrencyRates(key string, currencies []currencyItem) ([]currencyRate, error) {
	unavailable := platform.NewError(503, "Currency rates are temporarily unavailable")
	codes := make([]string, 0, len(currencies))
	for _, item := range currencies {
		codes = append(codes, item.Code)
	}
	query := url.Values{"base_currency": {"USD"}, "currencies": {strings.Join(codes, ",")}}
	endpoint := s.deps.Config.Get("CURRENCY_API_URL", "https://api.currencyapi.com/v3/latest")
	request, err := http.NewRequest(http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, unavailable
	}
	request.Header.Set("apikey", key)
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return nil, unavailable
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, unavailable
	}
	var payload struct {
		Data map[string]struct {
			Value *float64 `json:"value"`
		} `json:"data"`
	}
	if err = json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	rates := []currencyRate{}
	for _, item := range currencies {
		value := payload.Data[item.Code].Value
		if value != nil && *value > 0 && !math.IsInf(*value, 0) && !math.IsNaN(*value) {
			rates = append(rates, currencyRate{item.Code, item.Name, *value})
		}
	}
	return rates, nil
}
