package platform

import (
	"fmt"
	"math"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validUUID(value string) bool { return uuidPattern.MatchString(value) }

func scalarRule(rule Rule, name string, value interface{}) string {
	if message, handled := primitiveRule(rule.Name, value); handled {
		if message != "" {
			return name + message
		}
		return ""
	}
	if message, handled := textRule(rule, value); handled {
		if message != "" {
			return name + message
		}
		return ""
	}
	if message, handled := numberRule(rule, value); handled {
		if message != "" {
			return name + message
		}
		return ""
	}
	if message, handled := collectionRule(rule, value); handled {
		if message != "" {
			if rule.Name == "ArrayUnique" {
				return "All " + name + message
			}
			return name + message
		}
		return ""
	}
	return name + " has an unsupported validation rule: " + rule.Name
}

func primitiveRule(rule string, value interface{}) (string, bool) {
	valid, message := false, ""
	switch rule {
	case "IsString":
		_, valid = value.(string)
		message = " must be a string"
	case "IsBoolean":
		_, valid = value.(bool)
		message = " must be a boolean value"
	case "IsObject":
		_, valid = value.(map[string]interface{})
		message = " must be an object"
	case "IsArray":
		_, valid = value.([]interface{})
		message = " must be an array"
	case "IsNotEmpty":
		valid = value != nil && value != ""
		message = " should not be empty"
	default:
		return "", false
	}
	if valid {
		return "", true
	}
	return message, true
}

func textRule(rule Rule, value interface{}) (string, bool) {
	text, isString := value.(string)
	length := utf8.RuneCountInString(text)
	valid, message := false, ""
	switch rule.Name {
	case "MinLength":
		valid = isString && float64(length) >= argumentNumber(rule, 0)
		message = " must be longer than or equal to " + argumentLabel(rule, 0) + " characters"
	case "MaxLength":
		valid = isString && float64(length) <= argumentNumber(rule, 0)
		message = " must be shorter than or equal to " + argumentLabel(rule, 0) + " characters"
	case "Length":
		valid = isString && float64(length) >= argumentNumber(rule, 0) && float64(length) <= argumentNumber(rule, 1)
		message = lengthMessage(rule, value)
	case "Matches":
		pattern := fmt.Sprint(rule.Args[0])
		valid = isString && matchExpression(pattern, text)
		message = " must match " + pattern + " regular expression"
	default:
		return formatRule(rule, value)
	}
	if valid {
		return "", true
	}
	return message, true
}

func lengthMessage(rule Rule, value interface{}) string {
	length := math.NaN()
	truthy := true
	switch value := value.(type) {
	case nil:
		truthy = false
	case bool:
		truthy = value
	case float64:
		truthy = value != 0 && !math.IsNaN(value)
	case string:
		truthy = value != ""
		length = float64(jsLength(value))
	case []interface{}:
		length = float64(len(value))
	}
	if !truthy || length < argumentNumber(rule, 0) {
		return " must be longer than or equal to " + argumentLabel(rule, 0) + " characters"
	}
	if length > argumentNumber(rule, 1) {
		return " must be shorter than or equal to " + argumentLabel(rule, 1) + " characters"
	}
	return " must be longer than or equal to " + argumentLabel(
		rule,
		0,
	) + " and shorter than or equal to " + argumentLabel(
		rule,
		1,
	) + " characters"
}
func argumentLabel(rule Rule, index int) string {
	if number, ok := rule.Args[index].(float64); ok {
		return strconv.FormatFloat(number, 'f', -1, 64)
	}
	return fmt.Sprint(rule.Args[index])
}

func formatRule(rule Rule, value interface{}) (string, bool) {
	text, isString := value.(string)
	valid, message := false, ""
	switch rule.Name {
	case "IsEmail":
		valid = isString && validEmail(text)
		message = " must be an email"
	case "IsUUID":
		valid = isString && validUUIDVersion(text, rule)
		message = " must be a UUID"
	case "IsUrl":
		valid = isString && validURL(text, options(rule))
		message = " must be a URL address"
	case "IsISO8601":
		valid = isString && validISO8601(text, options(rule))
		message = " must be a valid ISO 8601 date string"
	default:
		return "", false
	}
	if valid {
		return "", true
	}
	return message, true
}

func argumentNumber(rule Rule, index int) float64 {
	if index >= len(rule.Args) {
		return 0
	}
	value, _ := rule.Args[index].(float64)
	return value
}

func numberRule(rule Rule, value interface{}) (string, bool) {
	number, isNumber := value.(float64)
	valid, message := false, ""
	switch rule.Name {
	case "IsInt":
		valid = isNumber && !math.IsInf(number, 0) && math.Trunc(number) == number
		message = " must be an integer number"
	case "IsNumber":
		valid = isNumber && !math.IsNaN(number) && !math.IsInf(number, 0)
		message = " must be a number conforming to the specified constraints"
	case "Min":
		valid = isNumber && number >= argumentNumber(rule, 0)
		message = " must not be less than " + argumentLabel(rule, 0)
	case "Max":
		valid = isNumber && number <= argumentNumber(rule, 0)
		message = " must not be greater than " + argumentLabel(rule, 0)
	default:
		return "", false
	}
	if valid {
		return "", true
	}
	return message, true
}

func collectionRule(rule Rule, value interface{}) (string, bool) {
	array, isArray := value.([]interface{})
	valid, message := false, ""
	switch rule.Name {
	case "ArrayMaxSize":
		valid = isArray && float64(len(array)) <= argumentNumber(rule, 0)
		message = " must contain no more than " + argumentLabel(rule, 0) + " elements"
	case "ArrayNotEmpty":
		valid = isArray && len(array) > 0
		message = " should not be empty"
	case "ArrayUnique":
		valid = isArray && arrayUnique(array)
		message = "'s elements must be unique"
	case "IsIn":
		choices, _ := rule.Args[0].([]interface{})
		labels := []string{}
		for _, choice := range choices {
			if reflect.DeepEqual(value, choice) {
				valid = true
			}
			labels = append(labels, fmt.Sprint(choice))
		}
		message = " must be one of the following values: " + strings.Join(labels, ", ")
	default:
		return "", false
	}
	if valid {
		return "", true
	}
	return message, true
}

func matchExpression(literal, value string) bool {
	end := strings.LastIndex(literal, "/")
	if !strings.HasPrefix(literal, "/") || end <= 0 {
		return false
	}
	pattern := literal[1:end]
	if strings.Contains(literal[end+1:], "i") {
		pattern = "(?i)" + pattern
	}
	expression, err := regexp.Compile(pattern)
	return err == nil && expression.MatchString(value)
}
