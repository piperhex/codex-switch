package platform

import (
	"encoding/json"
	"reflect"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const JavaScriptTimeLayout = "2006-01-02T15:04:05.000Z"

// WriteJSON preserves Date.toISOString wire formatting while leaving user strings untouched.
func WriteJSON(c *gin.Context, status int, value interface{}) {
	c.JSON(status, jsonDates(reflect.ValueOf(value)))
}

func JSONValue(value interface{}) interface{} { return jsonDates(reflect.ValueOf(value)) }

func jsonDates(value reflect.Value) interface{} {
	if !value.IsValid() {
		return nil
	}
	if value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface {
		if value.IsNil() {
			return nil
		}
		return jsonDates(value.Elem())
	}
	if value.CanInterface() {
		if date, ok := value.Interface().(time.Time); ok {
			return date.UTC().Format(JavaScriptTimeLayout)
		}
		if _, ok := value.Interface().(json.Marshaler); ok {
			return value.Interface()
		}
	}
	switch value.Kind() {
	case reflect.Struct:
		return jsonStructDates(value)
	case reflect.Map:
		if value.IsNil() {
			return nil
		}
		result := JSON{}
		iterator := value.MapRange()
		for iterator.Next() {
			result[iterator.Key().String()] = jsonDates(iterator.Value())
		}
		return result
	case reflect.Slice, reflect.Array:
		if value.Kind() == reflect.Slice && value.IsNil() {
			return nil
		}
		if value.Type().Elem().Kind() == reflect.Uint8 {
			return value.Interface()
		}
		result := make([]interface{}, value.Len())
		for index := range result {
			result[index] = jsonDates(value.Index(index))
		}
		return result
	default:
		return value.Interface()
	}
}

func jsonStructDates(value reflect.Value) JSON {
	result := JSON{}
	for index := 0; index < value.NumField(); index++ {
		field := value.Type().Field(index)
		if !field.IsExported() && !field.Anonymous {
			continue
		}
		name, options, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name == "-" {
			continue
		}
		member := value.Field(index)
		if strings.Contains(options, "omitempty") && jsonEmpty(member) {
			continue
		}
		if field.Anonymous && name == "" {
			if embedded, ok := jsonDates(member).(JSON); ok {
				for key, value := range embedded {
					result[key] = value
				}
				continue
			}
		}
		if name == "" {
			name = field.Name
		}
		result[name] = jsonDates(member)
	}
	return result
}

func jsonEmpty(value reflect.Value) bool {
	switch value.Kind() {
	case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
		return value.Len() == 0
	case reflect.Struct:
		return false
	default:
		return value.IsZero()
	}
}
