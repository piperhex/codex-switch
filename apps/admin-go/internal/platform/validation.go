package platform

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
)

func (contract *Contract) fields(name string) []Field {
	schema := contract.Schemas[name]
	fields := append([]Field{}, schema.Fields...)
	if schema.Extends == "" {
		return fields
	}
	for _, field := range contract.fields(schema.Extends) {
		exists := false
		for _, own := range fields {
			if own.Name == field.Name {
				exists = true
				break
			}
		}
		if !exists {
			fields = append(fields, field)
		}
	}
	return fields
}

// Validate follows class-transformer defaults and class-validator decorator order.
func (contract *Contract) Validate(name string, body JSON, requestedOrder ...PropertyOrder) []string {
	order := PropertyOrder{}
	if len(requestedOrder) > 0 {
		order = requestedOrder[0]
	}
	stripPrototypeKeys(body)
	return contract.validateObject(name, body, order, "")
}
func (contract *Contract) validateObject(name string, body JSON, order PropertyOrder, path string) []string {
	fields := contract.fields(name)
	allowed := map[string]bool{}
	for _, field := range fields {
		allowed[field.Name] = true
		if _, exists := body[field.Name]; !exists && field.Default != nil && !(path == "" && order["#array"] != nil) {
			var initial interface{}
			if json.Unmarshal(field.Default, &initial) == nil {
				body[field.Name] = contract.initialValue(initial)
			}
		}
	}
	messages := []string{}
	unknown := []string{}
	for _, key := range orderedKeys(body, order[path]) {
		if !allowed[key] {
			unknown = append(unknown, key)
		}
	}
	for _, key := range unknown {
		messages = append(messages, "property "+key+" should not exist")
	}
	for _, field := range fields {
		messages = append(messages, contract.validateField(field, body, order, path)...)
	}
	return messages
}

func (contract *Contract) initialValue(value interface{}) interface{} {
	if object, ok := value.(map[string]interface{}); ok {
		if instance, ok := object["instance"].(string); ok {
			result := JSON{}
			contract.Validate(instance, result)
			return result
		}
	}
	return value
}

func skipField(field Field, value interface{}, present bool) bool {
	for _, rule := range field.Rules {
		if rule.Name == "IsOptional" && value == nil {
			return true
		}
		if rule.Name != "ValidateIf" || len(rule.Args) == 0 {
			continue
		}
		condition, _ := rule.Args[0].(string)
		if strings.Contains(condition, "!== ''") && value == "" {
			return true
		}
		if strings.Contains(condition, "!== undefined") && !present {
			return true
		}
	}
	return false
}

func (contract *Contract) validateField(field Field, body JSON, order PropertyOrder, path string) []string {
	value, present := body[field.Name]
	if field.Transform == "Number" && present && value != nil {
		value = transformNumber(value)
		body[field.Name] = value
	}
	if skipField(field, value, present) {
		return nil
	}
	messages := []string{}
	nested := []Rule{}
	for _, rule := range field.Rules {
		if rule.Name == "ValidateNested" {
			nested = append(nested, rule)
			continue
		}
		if message := validateRule(rule, field.Name, value); message != "" {
			messages = append(messages, message)
		}
	}
	for _, rule := range nested {
		if present {
			children := contract.validateNested(
				nestedValidation{field, value, rule, order, objectPath(path, field.Name)},
			)
			if len(children) > 0 {
				switch value.(type) {
				case map[string]interface{}, []interface{}:
					messages = []string{}
				}
			}
			messages = append(messages, children...)
		}
	}
	return messages
}

type nestedValidation struct {
	Field Field
	Value interface{}
	Rule  Rule
	Order PropertyOrder
	Path  string
}

func (contract *Contract) validateNested(input nestedValidation) []string {
	field, value, rule := input.Field, input.Value, input.Rule
	if object, ok := value.(map[string]interface{}); ok {
		return prefixMessages(field.Name+".", contract.validateObject(field.Transform, object, input.Order, input.Path))
	}
	if array, ok := value.([]interface{}); ok {
		messages := []string{}
		for index, item := range array {
			if object, ok := item.(map[string]interface{}); ok {
				messages = append(
					messages,
					prefixMessages(
						fmt.Sprintf("%s.%d.", field.Name, index),
						contract.validateObject(
							field.Transform,
							object,
							input.Order,
							objectPath(input.Path, strconv.Itoa(index)),
						),
					)...)
			} else {
				child := input
				child.Value = item
				child.Path = objectPath(input.Path, strconv.Itoa(index))
				messages = append(messages, prefixMessages(field.Name+".", contract.validateNested(child))...)
			}
		}
		return messages
	}
	prefix := ""
	if options(rule)["each"] == true {
		prefix = "each value in "
	}
	return []string{prefix + "nested property " + field.Name + " must be either object or array"}
}

func transformNumber(value interface{}) interface{} {
	if values, ok := value.([]interface{}); ok {
		result := make([]interface{}, len(values))
		for index, item := range values {
			if item != nil {
				result[index] = transformNumber(item)
			}
		}
		return result
	}
	return jsNumber(value)
}

func prefixMessages(prefix string, messages []string) []string {
	for index := range messages {
		messages[index] = prefix + messages[index]
	}
	return messages
}

func jsNumber(value interface{}) float64 {
	switch value := value.(type) {
	case float64:
		return value
	case bool:
		if value {
			return 1
		}
		return 0
	case string:
		value = strings.TrimSpace(value)
		if value == "" {
			return 0
		}
		if len(value) > 2 && value[0] == '0' {
			base := 0
			switch value[1] {
			case 'x', 'X':
				base = 16
			case 'o', 'O':
				base = 8
			case 'b', 'B':
				base = 2
			}
			if base != 0 {
				number, err := strconv.ParseUint(value[2:], base, 64)
				if err == nil {
					return float64(number)
				}
				return math.NaN()
			}
		}
		number, err := strconv.ParseFloat(value, 64)
		if err == nil {
			return number
		}
	}
	return math.NaN()
}

func options(rule Rule) JSON {
	if len(rule.Args) > 0 {
		if object, ok := rule.Args[len(rule.Args)-1].(map[string]interface{}); ok {
			return object
		}
	}
	return JSON{}
}

func validateRule(rule Rule, name string, value interface{}) string {
	if rule.Name == "IsOptional" || rule.Name == "ValidateIf" {
		return ""
	}
	if options(rule)["each"] == true {
		if values, ok := value.([]interface{}); ok {
			for _, item := range values {
				if message := scalarRule(rule, name, item); message != "" {
					return "each value in " + message
				}
			}
			return ""
		}
	}
	message := scalarRule(rule, name, value)
	if custom, ok := options(rule)["message"].(string); ok && message != "" {
		return custom
	}
	if options(rule)["each"] == true && message != "" {
		return "each value in " + message
	}
	return message
}

func arrayUnique(values []interface{}) bool {
	for index, value := range values {
		valueType := reflect.TypeOf(value)
		if valueType != nil && (valueType.Kind() == reflect.Map || valueType.Kind() == reflect.Slice) {
			continue
		}
		for _, other := range values[:index] {
			if reflect.DeepEqual(value, other) {
				return false
			}
		}
	}
	return true
}
