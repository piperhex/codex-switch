package platform

import (
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/dlclark/regexp2"
)

func validUUIDVersion(value string, rule Rule) bool {
	if !validUUID(value) {
		return false
	}
	version := "all"
	if len(rule.Args) > 0 {
		if text, ok := rule.Args[0].(string); ok {
			version = text
		}
	}
	if version == "loose" {
		return true
	}
	lower := strings.ToLower(value)
	if version == "all" || version == "nil" {
		if lower == "00000000-0000-0000-0000-000000000000" {
			return true
		}
	}
	if version == "all" || version == "max" {
		if lower == "ffffffff-ffff-ffff-ffff-ffffffffffff" {
			return true
		}
	}
	if !strings.ContainsRune("89ab", rune(lower[19])) {
		return false
	}
	if version == "all" {
		return lower[14] >= '1' && lower[14] <= '8'
	}
	return len(version) == 1 && version[0] >= '1' && version[0] <= '8' && lower[14] == version[0]
}

func jsLength(value string) int { return len(utf16.Encode([]rune(value))) }
func validDomain(value string, requireTLD bool) bool {
	parts := strings.Split(value, ".")
	tld := parts[len(parts)-1]
	if requireTLD && (len(parts) < 2 || !domainTLD.MatchString(tld)) {
		return false
	}
	if numericOnly.MatchString(tld) {
		return false
	}
	for _, part := range parts {
		if jsLength(part) > 63 || !domainLabel.MatchString(part) || strings.HasPrefix(part, "-") ||
			strings.HasSuffix(part, "-") {
			return false
		}
		for _, r := range part {
			if r >= 0xff01 && r <= 0xff5e {
				return false
			}
		}
	}
	return true
}

var domainTLD = regexp.MustCompile(
	`(?i)^(?:[a-z\x{00A1}-\x{00A8}\x{00AA}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]{2,}|xn[a-z0-9-]{2,})$`,
)
var domainLabel = regexp.MustCompile(`(?i)^[a-z\x{00a1}-\x{ffff}0-9-]+$`)
var numericOnly = regexp.MustCompile(`^\d+$`)

var emailLocal = regexp.MustCompile(
	"(?i)^[a-z0-9!#$%&'*+\\-/=?^_`{|}~\\x{00A1}-\\x{D7FF}\\x{F900}-\\x{FDCF}\\x{FDF0}-\\x{FFEF}]+$",
)

var emailQuoted = regexp.MustCompile(
	`^(?:[\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e` +
		`\x{00A0}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]|\\[\x01-\x09\x0b\x0c\x0d-\x7f` +
		`\x{00A0}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}])*$`,
)

func validEmail(value string) bool {
	if jsLength(value) > 254 {
		return false
	}
	at := strings.LastIndex(value, "@")
	if at < 0 {
		return false
	}
	local, domain := value[:at], value[at+1:]
	if len(local) > 64 || len(domain) > 254 || !validDomain(domain, true) {
		return false
	}
	if len(local) >= 2 && local[0] == '"' && local[len(local)-1] == '"' {
		return emailQuoted.MatchString(local[1 : len(local)-1])
	}
	for _, part := range strings.Split(local, ".") {
		if !emailLocal.MatchString(part) {
			return false
		}
	}
	return true
}
func validURL(value string, opts JSON) bool {
	if value == "" || jsLength(value) > 2084 {
		return false
	}
	for _, r := range value {
		if unicode.IsSpace(r) || r == '<' || r == '>' {
			return false
		}
	}
	requireProtocol := opts["require_protocol"] == true
	hasProtocol := strings.Contains(value, "://")
	if !hasProtocol {
		if requireProtocol || strings.HasPrefix(value, "//") {
			return false
		}
		value = "http://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	if !validURLProtocol(parsed.Scheme, opts) {
		return false
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return false
		}
	}
	if parsed.User != nil {
		auth := parsed.User.String()
		if auth == "" || auth == ":" || strings.Count(auth, ":") > 1 {
			return false
		}
	}
	host := parsed.Hostname()
	if net.ParseIP(host) != nil {
		return true
	}
	return validDomain(host, opts["require_tld"] != false)
}

func validURLProtocol(scheme string, opts JSON) bool {
	protocols := []interface{}{"http", "https", "ftp"}
	if requested, ok := opts["protocols"].([]interface{}); ok {
		protocols = requested
	}
	for _, protocol := range protocols {
		if strings.EqualFold(scheme, protocol.(string)) {
			return true
		}
	}
	return false
}

// The legacy validator.js grammar contains backreferences; bounded regexp2 execution preserves that grammar.
const isoGrammar = `^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|` +
	`W([0-4]\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))` +
	`([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([\.,]\d+(?!:))?)?` +
	`(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$`

var isoExpression = func() *regexp2.Regexp {
	expression := regexp2.MustCompile(isoGrammar, regexp2.ECMAScript)
	expression.MatchTimeout = 50 * time.Millisecond
	return expression
}()
var ordinalDate = regexp.MustCompile(`^(\d{4})-?(\d{3})(?:[ T]\.*|$)`)
var calendarDate = regexp.MustCompile(`(\d{4})-?(\d{0,2})-?(\d*)`)

func validISO8601(value string, opts JSON) bool {
	matched, err := isoExpression.MatchString(value)
	if err != nil || !matched {
		return false
	}
	if opts["strictSeparator"] == true && strings.Contains(value, " ") {
		return false
	}
	if opts["strict"] != true {
		return true
	}
	if match := ordinalDate.FindStringSubmatch(value); match != nil {
		year, _ := strconv.Atoi(match[1])
		day, _ := strconv.Atoi(match[2])
		limit := 365
		if year%4 == 0 && year%100 != 0 || year%400 == 0 {
			limit = 366
		}
		return day <= limit
	}
	match := calendarDate.FindStringSubmatch(value)
	if match == nil {
		return false
	}
	year, _ := strconv.Atoi(match[1])
	month, _ := strconv.Atoi(match[2])
	day, _ := strconv.Atoi(match[3])
	if month == 0 || day == 0 {
		return true
	}
	date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	return date.Year() == year && int(date.Month()) == month && date.Day() == day
}
