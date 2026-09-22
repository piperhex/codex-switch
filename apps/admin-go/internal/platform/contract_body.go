package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
)

// prepareBody mirrors the legacy Express parser before authentication and DTO validation.
// Its error handler falls through to Nest's 404 response; the migration retains that observable behavior.
func prepareBody(c *gin.Context) bool {
	kind := strings.ToLower(c.ContentType())
	if (kind != "application/json" && kind != "application/x-www-form-urlencoded") || c.Request.Body == nil {
		return true
	}
	body, charset, err := decodedRequestBody(c.Request)
	if err != nil || !validBodyCharset(kind, charset) {
		bodyParseFailure(c)
		return false
	}
	object, order, err := parseRequestBody(body, kind, charset)
	if err != nil {
		bodyParseFailure(c)
		return false
	}
	c.Set("parsedBody", object)
	c.Set("propertyOrder", order)
	if order["#array"] != nil {
		c.Set("bodyIsArray", true)
	}
	encoded, err := json.Marshal(object)
	if err != nil {
		bodyParseFailure(c)
		return false
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(encoded))
	return true
}

func validBodyCharset(kind, charset string) bool {
	if kind == "application/json" {
		return strings.HasPrefix(charset, "utf-")
	}
	return charset == "utf-8" || charset == "iso-8859-1"
}

func parseRequestBody(body []byte, kind, charset string) (JSON, PropertyOrder, error) {
	if kind == "application/x-www-form-urlencoded" {
		return parseExtendedForm(string(body), charset)
	}
	if len(body) > 0 && len(bytes.TrimSpace(body)) == 0 {
		return nil, nil, errors.New("JSON body contains only whitespace")
	}
	return DecodeObject(body)
}
func bodyParseFailure(c *gin.Context) {
	Fail(c, 404, "Cannot "+c.Request.Method+" "+c.Request.URL.RequestURI())
}
