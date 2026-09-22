package platform

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"strings"

	"github.com/gin-gonic/gin"
)

const multipartMemoryBytes = 20 << 20
const multipartFieldBytes = 1 << 20

// Multer runs before ValidationPipe, including field, count, size and MIME checks.
func (contract *Contract) validateMultipart(c *gin.Context, route Route) bool {
	var raw bytes.Buffer
	c.Request.Body = io.NopCloser(io.TeeReader(c.Request.Body, &raw))
	if err := c.Request.ParseMultipartForm(multipartMemoryBytes); err != nil {
		Fail(c, 400, "Unexpected end of form")
		return false
	}
	_, parameters, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || parameters["boundary"] == "" {
		Fail(c, 400, "Multipart: Boundary not found")
		return false
	}
	reader := multipart.NewReader(bytes.NewReader(raw.Bytes()), parameters["boundary"])
	checker := multipartValidator{Path: route.Path, FileCounts: map[string]int{}}
	keys := []string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			Fail(c, 400, "Unexpected end of form")
			return false
		}
		if err = checker.checkPart(part, c.Request.MultipartForm); err != nil {
			Respond(c, nil, err)
			return false
		}
		if part.FileName() == "" {
			keys = append(keys, part.FormName())
		}
		if err = part.Close(); err != nil {
			Fail(c, 400, "Unexpected end of form")
			return false
		}
	}
	body := formObject(c.Request.MultipartForm.Value)
	if !validationResult(c, contract.Validate(route.BodyDTO, body, PropertyOrder{"": keys})) {
		return false
	}
	c.Set("validatedBody", body)
	return true
}

type multipartValidator struct {
	Path       string
	FileCounts map[string]int
	TotalFiles int
}

func (checker *multipartValidator) checkPart(part *multipart.Part, form *multipart.Form) error {
	name := part.FormName()
	if part.FileName() == "" {
		values := form.Value[name]
		for _, value := range values {
			if len(value) > multipartFieldBytes {
				return NewError(400, "Field value too long - "+name)
			}
		}
		return nil
	}
	checker.TotalFiles++
	checker.FileCounts[name]++
	skills := checker.Path == "/skills" || strings.HasPrefix(checker.Path, "/skills/")
	if skills && checker.TotalFiles > 2 {
		return NewError(400, "Too many files")
	}
	maximum := int64(5 << 20)
	if skills {
		maximum = 1 << 20
		if (name != "archive" && name != "preview") || checker.FileCounts[name] > 1 {
			return NewError(400, "Unexpected field - "+name)
		}
	}
	if !skills && (name != "images" || checker.FileCounts[name] > 4) {
		return NewError(400, "Unexpected field - "+name)
	}
	if !skills {
		mimeType, _, _ := mime.ParseMediaType(part.Header.Get("Content-Type"))
		if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/webp" {
			return NewError(400, "Only JPEG, PNG and WebP images are supported")
		}
	}
	if files := form.File[name]; checker.FileCounts[name] <= len(files) &&
		files[checker.FileCounts[name]-1].Size > maximum {
		return NewError(413, "File too large")
	}
	return nil
}
