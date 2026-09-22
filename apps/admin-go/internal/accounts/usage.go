package accounts

import (
	"encoding/json"
	"fmt"
	"github.com/codex-switch/admin-go/internal/platform"
	"math"
	"sort"
	"strings"
	"time"
)

const usageBase = "https://chatgpt.com/backend-api/wham"

type storedAccount struct {
	Personal *account
	System   *systemAccount
	Owner    string
}

func (r *storedAccount) auth() object {
	if r.System != nil {
		return r.System.Auth
	}
	return r.Personal.Auth
}
func (r *storedAccount) codexID() string {
	id := r.Personal
	if r.System != nil {
		if r.System.CodexAccountID != nil {
			return *r.System.CodexAccountID
		}
		return ""
	}
	if id.CodexAccountID != nil {
		return *id.CodexAccountID
	}
	return ""
}

func (s *service) resolveAccount(owner, id string) (*storedAccount, error) {
	bound, err := s.boundAccounts(owner)
	if err != nil {
		return nil, err
	}
	for _, row := range bound {
		if row.SyncAccountID == id {
			return &storedAccount{System: &row, Owner: owner}, nil
		}
	}
	row := account{}
	err = s.deps.DB.Where(`"ownerId" = ? AND "accountId" = ? AND "deletedAt" IS NULL`, owner, id).First(&row).Error
	if err != nil {
		return nil, notFound(err, "Synced account not found")
	}
	return &storedAccount{Personal: &row, Owner: owner}, nil
}

func (s *service) codexRequest(row *storedAccount, options requestOptionsHTTP) (*responseHTTP, error) {
	response, err := s.sendCodex(row, options)
	if err != nil || response.Status != 401 {
		return response, err
	}
	auth, err := s.refreshAccount(row.auth())
	if err != nil {
		return nil, err
	}
	modified := now()
	if row.System != nil {
		row.System.Auth = auth
		row.System.LastModifiedAt = modified
		err = s.deps.DB.Save(row.System).Error
		if err == nil {
			err = s.invalidateSystem(row.System.ID)
		}
	} else {
		row.Personal.Auth = auth
		row.Personal.LastModifiedAt = modified
		row.Personal.FieldModifiedAt = copyObject(row.Personal.FieldModifiedAt)
		row.Personal.FieldModifiedAt["auth"] = iso(modified)
		err = s.deps.DB.Save(row.Personal).Error
		if err == nil {
			err = s.invalidate(row.Owner, false)
		}
	}
	if err != nil {
		return nil, err
	}
	response, err = s.sendCodex(row, options)
	if err != nil {
		return nil, err
	}
	if response.Status == 401 {
		return nil, platform.NewError(400, "该账号的登录凭据已失效，请在桌面端重新登录")
	}
	return response, nil
}

func (s *service) sendCodex(row *storedAccount, options requestOptionsHTTP) (*responseHTTP, error) {
	token := str(obj(row.auth()["tokens"])["access_token"])
	if token == "" {
		return nil, platform.NewError(400, "当前账号没有可用的 Codex 登录凭据")
	}
	options.Proxy = true
	options.Headers = map[string]string{"Authorization": "Bearer " + token}
	if id := row.codexID(); id != "" {
		options.Headers["ChatGPT-Account-Id"] = id
	}
	response, err := s.request(options)
	if err != nil {
		return nil, platform.NewError(502, "无法连接 Codex 服务")
	}
	return response, nil
}

func chineseResponse(response *responseHTTP, context string) (object, error) {
	var value interface{}
	if json.Unmarshal(response.Raw, &value) != nil {
		return nil, platform.NewError(502, context+"：响应不是有效 JSON")
	}
	result, ok := value.(map[string]interface{})
	if !ok {
		return nil, platform.NewError(502, context+"：响应格式无效")
	}
	return result, nil
}

func (s *service) refreshAccount(auth object) (object, error) {
	tokens := obj(auth["tokens"])
	refresh := str(tokens["refresh_token"])
	if refresh == "" {
		return nil, platform.NewError(400, "该账号的登录凭据已失效，请在桌面端重新登录")
	}
	response, err := s.request(
		requestOptionsHTTP{
			URL:    defaultIssuer + "/oauth/token",
			Method: "POST",
			Body:   object{"client_id": defaultClientID, "grant_type": "refresh_token", "refresh_token": refresh},
			Proxy:  true,
		},
	)
	if err != nil {
		return nil, platform.NewError(502, "无法连接 Codex 登录服务刷新账号凭据")
	}
	if !response.ok() {
		return nil, platform.NewError(400, "该账号的登录凭据已失效，请在桌面端重新登录")
	}
	payload, err := chineseResponse(response, "解析账号凭据刷新响应失败")
	if err != nil {
		return nil, err
	}
	if str(payload["access_token"]) == "" {
		return nil, platform.NewError(502, "账号凭据刷新响应缺少 access_token")
	}
	next := copyObject(tokens)
	next["access_token"] = payload["access_token"]
	for _, key := range []string{"id_token", "refresh_token"} {
		if str(payload[key]) != "" {
			next[key] = payload[key]
		}
	}
	result := copyObject(auth)
	result["tokens"] = next
	result["last_refresh"] = iso(now())
	return result, nil
}

func (s *service) usage(owner, id string) (interface{}, error) {
	row, err := s.resolveAccount(owner, id)
	if err != nil {
		return nil, err
	}
	response, err := s.codexRequest(row, requestOptionsHTTP{URL: usageBase + "/usage"})
	if err != nil {
		return nil, err
	}
	if !response.ok() {
		return nil, platform.NewError(502, fmt.Sprintf("Codex 用量接口返回 HTTP %d", response.Status))
	}
	payload, err := chineseResponse(response, "解析 Codex 用量响应失败")
	if err != nil {
		return nil, err
	}
	limits := obj(payload["rate_limit"])
	plan := strings.TrimSpace(str(payload["plan_type"]))
	var planValue interface{}
	if plan != "" {
		planValue = plan
	}
	return object{
		"primary":      usageWindow(limits["primary_window"]),
		"secondary":    usageWindow(limits["secondary_window"]),
		"apiExpiresAt": promoExpiration(payload["promo"]),
		"plan":         planValue,
		"fetchedAt":    iso(now()),
		"error":        nil,
	}, nil
}

func usageWindow(value interface{}) interface{} {
	window := obj(value)
	used, ok := window["used_percent"].(float64)
	if !ok || math.IsNaN(used) || math.IsInf(used, 0) {
		return nil
	}
	used = math.Max(0, math.Min(100, used))
	var reset, minutes interface{}
	if n, ok := window["reset_at"].(float64); ok {
		reset = n
	}
	if n, ok := window["limit_window_seconds"].(float64); ok && n > 0 {
		minutes = math.Floor(n / 60)
	}
	return object{
		"usedPercent":      used,
		"remainingPercent": math.Max(0, math.Min(100, 100-used)),
		"resetsAt":         reset,
		"windowMinutes":    minutes,
	}
}

func normalizedTimestamp(value interface{}) string {
	if n, ok := value.(float64); ok {
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return ""
		}
		if math.Abs(n) < 100000000000 {
			n *= 1000
		}
		if math.Abs(n) > 8640000000000000 {
			return ""
		}
		return iso(time.UnixMilli(int64(n)))
	}
	parsed := date(value)
	if parsed.IsZero() {
		return ""
	}
	return iso(parsed)
}

func promoExpiration(value interface{}) interface{} {
	values := []string{}
	collectExpirations(value, &values)
	sort.Strings(values)
	if len(values) == 0 {
		return nil
	}
	return values[0]
}
func collectExpirations(value interface{}, result *[]string) {
	if rows, ok := value.([]interface{}); ok {
		for _, row := range rows {
			collectExpirations(row, result)
		}
		return
	}
	for key, nested := range obj(value) {
		normalized := strings.ReplaceAll(strings.ToLower(key), "-", "_")
		compact := strings.ReplaceAll(normalized, "_", "")
		matched := strings.Contains(normalized, "expir")
		for _, suffix := range []string{"until", "end", "endat", "endsat", "enddate", "endson"} {
			matched = matched || strings.HasSuffix(compact, suffix)
		}
		if matched {
			if timestamp := normalizedTimestamp(nested); timestamp != "" {
				*result = append(*result, timestamp)
			}
		}
		collectExpirations(nested, result)
	}
}

func (s *service) credits(owner, id string) (interface{}, error) {
	row, err := s.resolveAccount(owner, id)
	if err != nil {
		return nil, err
	}
	return s.accountCredits(row)
}
func (s *service) accountCredits(row *storedAccount) (object, error) {
	response, err := s.codexRequest(row, requestOptionsHTTP{URL: usageBase + "/rate-limit-reset-credits"})
	if err != nil {
		return nil, err
	}
	if !response.ok() {
		return nil, platform.NewError(502, fmt.Sprintf("Codex 重置卡接口返回 HTTP %d", response.Status))
	}
	payload, err := chineseResponse(response, "解析重置卡响应失败")
	if err != nil {
		return nil, err
	}
	values, ok := payload["credits"].([]interface{})
	if !ok {
		return nil, platform.NewError(502, "重置卡接口响应缺少 credits 列表")
	}
	credits := []object{}
	for _, value := range values {
		item := obj(value)
		credit := object{"issuedAt": nil, "expiresAt": nil}
		if t := normalizedTimestamp(valueOr(item["granted_at"], item["created_at"])); t != "" {
			credit["issuedAt"] = t
		}
		if t := normalizedTimestamp(item["expires_at"]); t != "" {
			credit["expiresAt"] = t
		}
		credits = append(credits, credit)
	}
	sort.SliceStable(
		credits,
		func(i, j int) bool { return str(credits[i]["expiresAt"]) < str(credits[j]["expiresAt"]) },
	)
	return object{"credits": credits}, nil
}

func (s *service) consumeCredit(owner, id string) (interface{}, error) {
	row, err := s.resolveAccount(owner, id)
	if err != nil {
		return nil, err
	}
	credits, err := s.accountCredits(row)
	if err != nil {
		return nil, err
	}
	if len(credits["credits"].([]object)) == 0 {
		return nil, platform.NewError(400, "当前账号没有可用重置卡")
	}
	response, err := s.codexRequest(
		row,
		requestOptionsHTTP{
			URL:    usageBase + "/rate-limit-reset-credits/consume",
			Method: "POST",
			Body:   object{"redeem_request_id": fmt.Sprintf("codex-switch-%d-%s", now().UnixMilli(), newID())},
		},
	)
	if err != nil {
		return nil, err
	}
	if !response.ok() {
		return nil, platform.NewError(502, fmt.Sprintf("Codex 重置卡使用接口返回 HTTP %d", response.Status))
	}
	payload, err := chineseResponse(response, "解析重置卡使用响应失败")
	if err != nil {
		return nil, err
	}
	code := str(payload["code"])
	switch code {
	case "reset", "already_redeemed":
		return object{"ok": true}, nil
	case "no_credit":
		return nil, platform.NewError(400, "当前账号没有可用重置卡")
	case "nothing_to_reset":
		return nil, platform.NewError(400, "当前账号当前没有需要重置的用量窗口")
	case "":
		return nil, platform.NewError(502, "Codex 重置卡使用接口响应缺少 code")
	}
	return nil, platform.NewError(502, "Codex 重置卡使用接口返回未知状态："+code)
}
