// Package tokenpricing validates and supplies model cost presets shared with PC clients.
package tokenpricing

import (
	_ "embed"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"regexp"
	"time"
)

const MaxModels = 1000
const maxRate = 1_000_000_000
const maxMultiplier = 100
const maxAliases = 20

//go:embed defaults.json
var defaultsJSON []byte

// Model contains USD prices per million tokens and the Fast mode cost multiplier.
type Model struct {
	Model              string   `json:"model"`
	Aliases            []string `json:"aliases,omitempty"`
	Input              *float64 `json:"input"`
	CachedInput        *float64 `json:"cachedInput"`
	Output             *float64 `json:"output"`
	LongContextPricing bool     `json:"longContextPricing"`
	FastModeMultiplier *float64 `json:"fastModeMultiplier"`
	SourceURL          string   `json:"sourceUrl"`
}

// Document is the public pricing payload. It contains no account or provider credentials.
type Document struct {
	Models     []Model `json:"models"`
	VerifiedAt string  `json:"verifiedAt"`
	SourceURL  string  `json:"sourceUrl"`
}

// Defaults returns a fresh copy so administrator edits cannot mutate bundled defaults.
func Defaults() Document {
	var result Document
	if err := json.Unmarshal(defaultsJSON, &result); err != nil {
		panic("invalid bundled token pricing")
	}
	return result
}

var modelName = regexp.MustCompile(`^[a-z0-9][a-z0-9._:/-]*$`)

func validName(name string) bool { return len(name) <= 128 && modelName.MatchString(name) }
func validSource(value string) bool {
	if value == "" {
		return true
	}
	parsed, err := url.Parse(value)
	return len(value) <= 2048 && err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}
func validRate(value *float64, maximum float64, positive bool) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= 0 &&
		*value <= maximum && (!positive || *value > 0)
}
func validModel(model Model) bool {
	return validName(model.Model) && len(model.Aliases) <= maxAliases && validSource(model.SourceURL) &&
		validRate(model.Input, maxRate, false) && validRate(model.CachedInput, maxRate, false) &&
		validRate(model.Output, maxRate, false) &&
		(model.FastModeMultiplier == nil || validRate(model.FastModeMultiplier, maxMultiplier, true))
}

// Validate rejects ambiguous model aliases and incomplete or unsafe price data.
func (document Document) Validate() error {
	_, err := time.Parse("2006-01-02", document.VerifiedAt)
	if err != nil || !validSource(document.SourceURL) || len(document.Models) == 0 || len(document.Models) > MaxModels {
		return errors.New("模型计价预设无效，请检查后重试。")
	}
	names := map[string]bool{}
	for _, model := range document.Models {
		if !validModel(model) {
			return errors.New("请填写有效的模型名称、价格和快速模式倍率。")
		}
		for _, name := range append([]string{model.Model}, model.Aliases...) {
			if !validName(name) || names[name] {
				return errors.New("模型名称和别名不能重复。")
			}
			names[name] = true
		}
	}
	return nil
}
