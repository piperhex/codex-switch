package identity

import (
	_ "embed"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

//go:embed templates.json
var templateJSON []byte

//go:embed verification-emails.json
var verificationEmailsJSON []byte

const officialAccountBoundCode = "official-account.bound"

var templateVariable = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

type templateDefinition struct {
	Code           string              `json:"code"`
	Name           string              `json:"name"`
	Description    string              `json:"description"`
	DefaultSubject string              `json:"defaultSubject"`
	DefaultBody    string              `json:"defaultBody"`
	Variables      []map[string]string `json:"variables"`
}

func templateDefinitions() []templateDefinition {
	var result []templateDefinition
	// Checked-in assets are generated from the legacy notification definitions.
	if err := json.Unmarshal(templateJSON, &result); err != nil {
		panic(err)
	}
	return result
}
func findTemplate(code string) (*templateDefinition, error) {
	for _, definition := range templateDefinitions() {
		if definition.Code == code {
			return &definition, nil
		}
	}
	return nil, platform.NewError(404, "Email template type does not exist")
}
func (s *service) registerTemplates(router *gin.Engine) {
	group := router.Group("/admin/api/email-templates")
	group.GET("", s.deps.RequirePermissions("admin.email-templates.read"), handle(s.listTemplates))
	group.GET("/:code", s.deps.RequirePermissions("admin.email-templates.read"), handle(s.getTemplate))
	group.PATCH("/:code", s.deps.RequirePermissions("admin.email-templates.manage"), handle(s.updateTemplate))
}
func (s *service) savedTemplate(code string) (*emailTemplate, error) {
	var row emailTemplate
	err := s.deps.DB.First(&row, "code = ?", code).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}
func presentTemplate(definition templateDefinition, row *emailTemplate) gin.H {
	result := gin.H{
		"code":           definition.Code,
		"name":           definition.Name,
		"description":    definition.Description,
		"subject":        definition.DefaultSubject,
		"body":           definition.DefaultBody,
		"mailServiceId":  nil,
		"variables":      definition.Variables,
		"customized":     row != nil,
		"updatedByEmail": nil,
		"updatedAt":      nil,
	}
	if row != nil {
		result["subject"] = row.Subject
		result["body"] = row.Body
		result["mailServiceId"] = row.MailServiceID
		result["updatedByEmail"] = nullIfEmpty(row.UpdatedByEmail)
		result["updatedAt"] = row.UpdatedAt
	}
	return result
}
func (s *service) listTemplates(*gin.Context) (interface{}, error) {
	result := []gin.H{}
	for _, definition := range templateDefinitions() {
		row, err := s.savedTemplate(definition.Code)
		if err != nil {
			return nil, err
		}
		result = append(result, presentTemplate(definition, row))
	}
	return result, nil
}
func (s *service) getTemplate(c *gin.Context) (interface{}, error) {
	definition, err := findTemplate(c.Param("code"))
	if err != nil {
		return nil, err
	}
	row, err := s.savedTemplate(definition.Code)
	return presentTemplate(*definition, row), err
}
func validateTemplateVariables(definition *templateDefinition, value string) error {
	supported := map[string]bool{}
	for _, variable := range definition.Variables {
		supported[variable["key"]] = true
	}
	for _, match := range templateVariable.FindAllStringSubmatch(value, -1) {
		key := strings.TrimSpace(match[1])
		if !supported[key] {
			return platform.NewError(400, "Unsupported email template variable: "+key)
		}
	}
	return nil
}
func validateTemplateContent(definition *templateDefinition, subject, body string) error {
	if subject == "" || body == "" {
		return platform.NewError(400, "Email template subject and body are required")
	}
	if strings.ContainsAny(subject, "\r\n") {
		return platform.NewError(400, "Email template subject must be a single line")
	}
	if err := validateTemplateVariables(definition, subject); err != nil {
		return err
	}
	return validateTemplateVariables(definition, body)
}
func (s *service) updateTemplate(c *gin.Context) (interface{}, error) {
	var request struct {
		Subject       string  `json:"subject"`
		Body          string  `json:"body"`
		MailServiceID *string `json:"mailServiceId"`
	}
	if err := bind(c, &request); err != nil {
		return nil, err
	}
	definition, err := findTemplate(c.Param("code"))
	if err != nil {
		return nil, err
	}
	request.Subject = strings.TrimSpace(request.Subject)
	request.Body = strings.TrimSpace(request.Body)
	if err = validateTemplateContent(definition, request.Subject, request.Body); err != nil {
		return nil, err
	}
	if err = s.selectableMail(request.MailServiceID); err != nil {
		return nil, err
	}
	row, err := s.savedTemplate(definition.Code)
	if err != nil {
		return nil, err
	}
	if row == nil {
		row = &emailTemplate{Code: definition.Code}
	}
	actor := platform.User(c)
	row.Subject = request.Subject
	row.Body = request.Body
	row.MailServiceID = request.MailServiceID
	row.UpdatedByID = &actor.ID
	row.UpdatedByEmail = actor.Email
	if err = s.deps.DB.Save(row).Error; err != nil {
		return nil, err
	}
	return presentTemplate(
			*definition,
			row,
		), s.record(
			actor,
			auditLog{Action: "email-template.update", TargetType: "email-template", TargetID: &row.Code},
		)
}
func renderTemplate(template string, values map[string]string) string {
	return templateVariable.ReplaceAllStringFunc(template, func(placeholder string) string {
		match := templateVariable.FindStringSubmatch(placeholder)
		if value, exists := values[strings.TrimSpace(match[1])]; exists {
			return value
		}
		return placeholder
	})
}
func templateHTML(body string) string {
	escaped := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#039;", "\n", "<br>").
		Replace(body)
	return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',` +
		`'Microsoft YaHei',Arial,sans-serif;font-size:15px;line-height:1.8;color:#24292f">` + escaped + `</div>`
}

// SendOfficialAccountBound sends the configurable notification after new account bindings are saved.
func SendOfficialAccountBound(deps *platform.Dependencies, recipient string, accounts []string, operator string) error {
	if len(accounts) == 0 {
		return nil
	}
	s := &service{deps}
	definition, err := findTemplate(officialAccountBoundCode)
	if err != nil {
		return err
	}
	row, err := s.savedTemplate(officialAccountBoundCode)
	if err != nil {
		return err
	}
	listed := make([]string, len(accounts))
	for index, email := range accounts {
		listed[index] = "- " + email
	}
	values := map[string]string{
		"userEmail":     recipient,
		"accountCount":  strconv.Itoa(len(accounts)),
		"accountEmails": strings.Join(listed, "\n"),
		"operatorEmail": operator,
		"boundAt": time.Now().
			In(time.FixedZone("Asia/Singapore", 8*3600)).
			Format("2006-01-02 15:04") +
			" (Asia/Singapore)",
	}
	subject, body := definition.DefaultSubject, definition.DefaultBody
	var serviceID *string
	if row != nil {
		subject = row.Subject
		body = row.Body
		serviceID = row.MailServiceID
	}
	body = renderTemplate(body, values)
	err = SendMail(
		deps,
		MailOptions{
			ServiceID: serviceID,
			To:        normalizedEmail(recipient),
			Subject:   renderTemplate(subject, values),
			Text:      body,
			HTML:      templateHTML(body),
		},
	)
	if err != nil {
		return platform.NewError(503, "Account binding notification email could not be sent")
	}
	return nil
}
func verificationMessage(code, purpose string, requestedAt time.Time) MailOptions {
	var templates map[string]map[string]string
	if err := json.Unmarshal(verificationEmailsJSON, &templates); err != nil {
		panic(err)
	}
	replace := strings.NewReplacer(
		"__CODE__",
		code,
		"__REQUESTED_AT__",
		requestedAt.UTC().Format("02 Jan 2006, 15:04 UTC"),
	)
	template := templates[purpose]
	return MailOptions{
		Subject: replace.Replace(template["subject"]),
		Text:    replace.Replace(template["text"]),
		HTML:    replace.Replace(template["html"]),
	}
}
