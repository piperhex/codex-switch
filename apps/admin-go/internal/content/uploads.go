package content

import (
	"bytes"
	"encoding/binary"
	"io"
	"mime"
	"mime/multipart"
	"regexp"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
)

const maxSkillBytes = 1024 * 1024

var drivePrefix = regexp.MustCompile(`^[a-zA-Z]:`)

type uploadedFile struct {
	Name, MIME string
	Data       []byte
}

func readUpload(header *multipart.FileHeader, limit int64) (*uploadedFile, error) {
	if header == nil {
		return nil, nil
	}
	if header.Size > limit {
		return nil, platform.NewError(413, "File too large")
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, platform.NewError(413, "File too large")
	}
	mimeType, _, _ := mime.ParseMediaType(header.Header.Get("Content-Type"))
	return &uploadedFile{Name: header.Filename, MIME: mimeType, Data: data}, nil
}
func imageMIME(value string) bool {
	return value == "image/jpeg" || value == "image/png" || value == "image/webp"
}
func imageSignature(file *uploadedFile) bool {
	data := file.Data
	switch file.MIME {
	case "image/jpeg":
		return len(data) >= 3 && bytes.Equal(data[:3], []byte{0xff, 0xd8, 0xff})
	case "image/png":
		return len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	default:
		return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	}
}
func validatePreview(file *uploadedFile) error {
	if !imageMIME(file.MIME) {
		return platform.NewError(400, "Skill preview must be a JPEG, PNG or WebP image")
	}
	if len(file.Data) > maxSkillBytes {
		return platform.NewError(400, "Skill preview must not exceed 1 MB")
	}
	if !imageSignature(file) {
		return platform.NewError(400, "Skill preview image data is invalid")
	}
	return nil
}

// ValidateSkillArchive preserves the legacy central-directory checks without extracting untrusted entries.
func ValidateSkillArchive(data []byte) error {
	if len(data) == 0 || len(data) > maxSkillBytes {
		return platform.NewError(400, "Skill archive must not exceed 1 MB")
	}
	end := -1
	minimum := max(0, len(data)-65557)
	for offset := len(data) - 22; offset >= minimum; offset-- {
		if binary.LittleEndian.Uint32(data[offset:]) == 0x06054b50 {
			end = offset
			break
		}
	}
	if end < 0 || binary.LittleEndian.Uint16(data[end+4:]) != 0 || binary.LittleEndian.Uint16(data[end+6:]) != 0 {
		return platform.NewError(400, "Skill archive is not a supported ZIP file")
	}
	count := int(binary.LittleEndian.Uint16(data[end+10:]))
	offset := int(binary.LittleEndian.Uint32(data[end+16:]))
	if count == 0 || count > 512 {
		return platform.NewError(400, "Skill archive must contain 1-512 entries")
	}
	var expanded uint64
	skills := 0
	for index := 0; index < count; index++ {
		next, size, skill, err := validateArchiveEntry(data, offset)
		if err != nil {
			return err
		}
		offset = next
		expanded += uint64(size)
		if skill {
			skills++
		}
		if expanded > 10*1024*1024 {
			return platform.NewError(400, "Expanded skill archive must not exceed 10 MB")
		}
	}
	if skills != 1 {
		return platform.NewError(400, "Skill archive must contain exactly one SKILL.md file")
	}
	return nil
}
func validateArchiveEntry(data []byte, offset int) (int, uint32, bool, error) {
	bad := func(message string) (int, uint32, bool, error) { return 0, 0, false, platform.NewError(400, message) }
	if offset < 0 || offset+46 > len(data) || binary.LittleEndian.Uint32(data[offset:]) != 0x02014b50 {
		return bad("Skill archive central directory is invalid")
	}
	nameEnd := offset + 46 + int(binary.LittleEndian.Uint16(data[offset+28:]))
	if nameEnd > len(data) {
		return bad("Skill archive entry name is invalid")
	}
	name := strings.ReplaceAll(string(data[offset+46:nameEnd]), `\`, "/")
	parts := strings.FieldsFunc(name, func(c rune) bool { return c == '/' })
	if name == "" || strings.HasPrefix(name, "/") || drivePrefix.MatchString(name) {
		return bad("Skill archive contains an unsafe path")
	}
	for _, part := range parts {
		if part == ".." {
			return bad("Skill archive contains an unsafe path")
		}
	}
	mode := binary.LittleEndian.Uint32(data[offset+38:]) >> 16
	if mode&0170000 == 0120000 {
		return bad("Skill archive must not contain symbolic links")
	}
	skill := !strings.HasSuffix(name, "/") && len(parts) > 0 && strings.EqualFold(parts[len(parts)-1], "skill.md")
	next := nameEnd + int(
		binary.LittleEndian.Uint16(data[offset+30:]),
	) + int(
		binary.LittleEndian.Uint16(data[offset+32:]),
	)
	return next, binary.LittleEndian.Uint32(data[offset+24:]), skill, nil
}
