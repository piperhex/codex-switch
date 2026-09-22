package platform

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed legacy-contract.json
var contractJSON []byte

// JSON values in the legacy DTO metadata are heterogeneous by definition.
type JSON = map[string]interface{}

type Rule struct {
	Name string
	Args []interface{}
}
type Field struct {
	Name      string
	Rules     []Rule
	Default   json.RawMessage
	Transform string
}
type Schema struct {
	Fields  []Field
	Extends string
}
type Route struct {
	Method         string
	Path           string
	Auth           bool
	Permissions    []string
	AnyPermissions []string
	Status         int
	Headers        map[string]string
	BodyDTO        string `json:"bodyDto"`
	QueryDTO       string `json:"queryDto"`
	UUIDParams     []string
}
type Contract struct {
	Routes  []Route
	Schemas map[string]Schema
}

func LoadContract() (*Contract, error) {
	var contract Contract
	if err := json.Unmarshal(contractJSON, &contract); err != nil {
		return nil, err
	}
	return &contract, nil
}

func (contract *Contract) Middleware(deps *Dependencies) gin.HandlerFunc {
	routes := map[string]Route{}
	for _, route := range contract.Routes {
		routes[route.Method+" "+route.Path] = route
	}
	return func(c *gin.Context) {
		defer func() {
			if c.Request.MultipartForm != nil {
				c.Request.MultipartForm.RemoveAll()
			}
		}()
		route, ok := routes[c.Request.Method+" "+c.FullPath()]
		if !ok {
			c.Next()
			return
		}
		if !authorizeContract(c, deps, route) {
			return
		}
		if !contract.validateRequest(c, route) {
			return
		}
		for name, value := range route.Headers {
			c.Header(name, value)
		}
		c.Next()
	}
}

func authorizeContract(c *gin.Context, deps *Dependencies, route Route) bool {
	if !route.Auth {
		return true
	}
	if deps.Authenticate == nil {
		Fail(c, 401, "Unauthorized")
		return false
	}
	user, err := deps.Authenticate(c)
	if err != nil {
		Respond(c, nil, err)
		return false
	}
	if user == nil {
		Fail(c, 401, "Unauthorized")
		return false
	}
	c.Set("principal", user)
	if !HasPermissions(user, route.Permissions, false) ||
		(len(route.AnyPermissions) > 0 && !HasPermissions(user, route.AnyPermissions, true)) {
		Fail(c, 403, "Insufficient permission")
		return false
	}
	return true
}

func (contract *Contract) validateRequest(c *gin.Context, route Route) bool {
	for _, param := range route.UUIDParams {
		if !validUUID(c.Param(param)) {
			Fail(c, 400, "Validation failed (uuid is expected)")
			return false
		}
	}
	if _, exists := contract.Schemas[route.QueryDTO]; exists {
		query := formObject(c.Request.URL.Query())
		order := formOrder(c.Request.URL.RawQuery)
		if !validationResult(c, contract.Validate(route.QueryDTO, query, order)) {
			return false
		}
		c.Set("validatedQuery", query)
	}
	if _, exists := contract.Schemas[route.BodyDTO]; !exists {
		return true
	}
	if strings.HasPrefix(c.ContentType(), "multipart/") &&
		(route.Path == "/skills" || route.Path == "/skills/:id" ||
			route.Path == "/feedback" || route.Path == "/feedback/authenticated") {
		return contract.validateMultipart(c, route)
	}
	body, order, err := requestObject(c)
	if err != nil {
		Respond(c, nil, err)
		return false
	}
	if !validationResult(c, contract.Validate(route.BodyDTO, body, order)) {
		return false
	}
	c.Set("validatedBody", body)
	encoded, err := json.Marshal(body)
	if err != nil {
		Respond(c, nil, err)
		return false
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(encoded))
	c.Request.ContentLength = int64(len(encoded))
	return true
}

func requestObject(c *gin.Context) (JSON, PropertyOrder, error) {
	if value, ok := c.Get("parsedBody"); ok {
		order, _ := c.Get("propertyOrder")
		return value.(JSON), order.(PropertyOrder), nil
	}
	const maxRequestBytes = 12 * 1024 * 1024
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxRequestBytes)
	if c.ContentType() == "application/x-www-form-urlencoded" {
		if err := c.Request.ParseForm(); err != nil {
			return nil, nil, NewError(400, "Bad Request")
		}
		return formObject(c.Request.PostForm), nil, nil
	}
	if c.ContentType() != "application/json" {
		return JSON{}, nil, nil
	}
	data, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, nil, NewError(413, "request entity too large")
	}
	body, order, err := DecodeObject(data)
	if err != nil {
		return nil, nil, NewError(400, "Invalid JSON body")
	}
	return body, order, nil
}

func formObject(form url.Values) JSON {
	body := JSON{}
	for key, values := range form {
		if len(values) == 1 {
			body[key] = values[0]
		} else {
			items := make([]interface{}, len(values))
			for index, value := range values {
				items[index] = value
			}
			body[key] = items
		}
	}
	return body
}
func formOrder(raw string) PropertyOrder {
	keys := []string{}
	seen := map[string]bool{}
	for _, pair := range strings.Split(raw, "&") {
		key, _, _ := strings.Cut(pair, "=")
		decoded, err := url.QueryUnescape(key)
		if err != nil || seen[decoded] {
			continue
		}
		seen[decoded] = true
		keys = append(keys, decoded)
	}
	return PropertyOrder{"": keys}
}

func validationResult(c *gin.Context, messages []string) bool {
	if len(messages) == 0 {
		return true
	}
	c.AbortWithStatusJSON(400, gin.H{"message": messages, "error": "Bad Request", "statusCode": 400})
	return false
}

// Query returns transformed query values without changing the original request URL.
func Query(c *gin.Context) JSON {
	if value, ok := c.Get("validatedQuery"); ok {
		return value.(JSON)
	}
	return formObject(c.Request.URL.Query())
}

// Body returns the validated body while preserving explicit null and omitted property distinctions.
func Body(c *gin.Context) JSON {
	if value, ok := c.Get("validatedBody"); ok {
		return value.(JSON)
	}
	return JSON{}
}
