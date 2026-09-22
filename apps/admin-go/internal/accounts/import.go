package accounts

import (
	"fmt"
	"github.com/codex-switch/admin-go/internal/platform"
	"strconv"
	"strings"
)

func (s *service) importAccounts(actor *platform.Principal, in object, kind string) (interface{}, error) {
	var values []interface{}
	var err error
	switch kind {
	case "personal":
		values, err = parsePersonal(str(in["content"]))
	case "sub2api":
		values, err = parseSub2api(str(in["content"]))
	default:
		values, err = parseCompatible(str(in["content"]))
	}
	if err != nil {
		return nil, err
	}
	if kind == "personal" && len(values) > maxImportAccounts {
		return nil, platform.NewError(400, "单次最多导入 1000 个账号")
	}
	accounts := []object{}
	skipped := []string{}
	for index, value := range values {
		row, e := s.importOne(actor, importOptions{Input: in, Value: value, Kind: kind})
		if e == nil {
			accounts = append(accounts, row)
			continue
		}
		skipped = append(skipped, importFailureMessage(index, kind, e))
	}
	if len(accounts) == 0 {
		message := "No accounts could be imported"
		if kind == "personal" {
			message = "没有可导入的账号"
		}
		if len(skipped) > 0 {
			message = skipped[0]
		}
		return nil, platform.NewError(400, message)
	}
	return object{
		"accounts":      accounts,
		"importedCount": len(accounts),
		"skippedCount":  len(skipped),
		"skipped":       skipped,
	}, nil
}

func importFailureMessage(index int, kind string, err error) string {
	detail := "Unable to import account"
	if kind == "personal" {
		detail = "账号导入失败"
	}
	if public, ok := err.(*platform.HTTPError); ok {
		detail = public.Message
	}
	if kind == "personal" {
		return fmt.Sprintf("第 %d 个账号：%s", index+1, detail)
	}
	return fmt.Sprintf("Account %d: %s", index+1, detail)
}

type importOptions struct {
	Input object
	Value interface{}
	Kind  string
}

func (s *service) importOne(actor *platform.Principal, options importOptions) (object, error) {
	var auth object
	var err error
	switch options.Kind {
	case "personal":
		auth, err = normalizePersonalAuth(options.Value)
	case "sub2api":
		auth, err = normalizeSub2api(options.Value)
	default:
		auth, err = normalizeCompatibleAuth(options.Value)
	}
	if err != nil {
		return nil, err
	}
	if options.Kind != "sub2api" && str(obj(auth["tokens"])["access_token"]) == "" {
		auth, err = s.refreshImport(auth, options.Kind == "personal")
		if err != nil {
			return nil, err
		}
	}
	metadata := importMetadata(obj(options.Value), options.Kind == "personal")
	for _, key := range []string{"note", "expiresAt"} {
		if has(options.Input, key) && options.Input[key] != nil {
			metadata[key] = options.Input[key]
		}
	}
	if options.Kind != "personal" {
		metadata["auth"] = auth
		return s.createOfficial(actor, metadata)
	}
	row, err := s.personalFromAuth(actor.ID, auth)
	if err != nil {
		return nil, err
	}
	if row["official"] == true || (str(metadata["note"]) == "" && str(metadata["expiresAt"]) == "") {
		return row, nil
	}
	patch := object{
		"note":           valueOr(metadata["note"], row["note"]),
		"expiresAt":      valueOr(metadata["expiresAt"], row["expiresAt"]),
		"privateDetails": valueOr(row["privateDetails"], object{"password": "", "phoneNumber": "", "totpSecret": ""}),
	}
	result, err := s.updateDetails(writeOptions{Owner: actor.ID}, str(row["id"]), patch)
	return obj(result), err
}

func importMetadata(source object, personal bool) object {
	result := object{}
	notePaths := []string{"account_note", "accountInfo", "account_info", "note", "notes", "remark"}
	if personal {
		notePaths = []string{"note", "remark", "description"}
	}
	if note := firstPath(source, notePaths...); note != "" {
		result["note"] = note
	}
	if personal {
		if value := firstPath(source, "expiresAt", "expires_at", "expiration"); value != "" {
			result["expiresAt"] = value
		}
		return result
	}
	for _, path := range []string{"expires", "expiresAt", "expires_at", "expired", "credentials.expires_at"} {
		value := pathValue(source, path)
		if value == nil || value == "" {
			continue
		}
		if text, ok := value.(string); ok {
			if n, err := strconv.ParseFloat(strings.TrimSpace(text), 64); err == nil {
				value = n
			}
		}
		if t := normalizedTimestamp(value); t != "" {
			result["expiresAt"] = t[:10]
		}
		break
	}
	return result
}

func (s *service) refreshImport(auth object, personal bool) (object, error) {
	token := strings.TrimSpace(str(obj(auth["tokens"])["refresh_token"]))
	if token == "" {
		message := "The imported account does not contain an access token or refresh token"
		if personal {
			message = "账号凭据缺少 access_token 或 refresh_token"
		}
		return nil, platform.NewError(400, message)
	}
	issuer, client := s.issuer(), s.clientID()
	if personal {
		issuer = defaultIssuer
		client = defaultClientID
	}
	response, err := s.request(
		requestOptionsHTTP{
			URL:    issuer + "/oauth/token",
			Method: "POST",
			Body:   object{"client_id": client, "grant_type": "refresh_token", "refresh_token": token},
		},
	)
	if err != nil {
		message := "Unable to reach the Codex OAuth service to refresh credentials"
		if personal {
			message = "无法连接 Codex 登录服务刷新账号凭据"
		}
		return nil, platform.NewError(502, message)
	}
	if !response.ok() {
		message := fmt.Sprintf("Unable to refresh imported credentials (HTTP %d)", response.Status)
		if personal {
			message = fmt.Sprintf("账号凭据刷新失败（HTTP %d）", response.Status)
		}
		return nil, platform.NewError(502, message)
	}
	payload, err := response.object("Codex OAuth refresh response")
	if err != nil {
		if personal {
			return nil, platform.NewError(502, "刷新响应缺少 access_token")
		}
		return nil, err
	}
	return applyImportedRefresh(auth, payload, personal)
}

func applyImportedRefresh(auth, payload object, personal bool) (object, error) {
	tokens := copyObject(obj(auth["tokens"]))
	for _, key := range []string{"id_token", "access_token", "refresh_token"} {
		if value := strings.TrimSpace(str(payload[key])); value != "" {
			tokens[key] = value
		}
	}
	if str(tokens["access_token"]) == "" {
		message := "Codex OAuth refresh response is missing access_token"
		if personal {
			message = "刷新响应缺少 access_token"
		}
		return nil, platform.NewError(502, message)
	}
	if personal {
		result := copyObject(auth)
		result["tokens"] = tokens
		return result, nil
	}
	return object{"tokens": tokens}, nil
}
