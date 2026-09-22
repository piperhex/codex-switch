package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// PropertyOrder records original JSON property order, including nested objects.
type PropertyOrder map[string][]string

func objectPath(parent, key string) string {
	return parent + "/" + strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
}
func orderedKeys(body JSON, keys []string) []string {
	seen := map[string]bool{}
	numbers, stringsInOrder := []string{}, []string{}
	for _, key := range keys {
		if _, ok := body[key]; !ok || seen[key] {
			continue
		}
		seen[key] = true
		if integerKey(key) {
			numbers = append(numbers, key)
		} else {
			stringsInOrder = append(stringsInOrder, key)
		}
	}
	remaining := []string{}
	for key := range body {
		if !seen[key] {
			remaining = append(remaining, key)
		}
	}
	sort.Strings(remaining)
	for _, key := range remaining {
		if integerKey(key) {
			numbers = append(numbers, key)
		} else {
			stringsInOrder = append(stringsInOrder, key)
		}
	}
	sort.Slice(numbers, func(i, j int) bool {
		left, _ := strconv.ParseUint(numbers[i], 10, 32)
		right, _ := strconv.ParseUint(numbers[j], 10, 32)
		return left < right
	})
	return append(numbers, stringsInOrder...)
}
func integerKey(value string) bool {
	parsed, err := strconv.ParseUint(value, 10, 32)
	return err == nil && parsed < 4294967295 && strconv.FormatUint(parsed, 10) == value
}

// DecodeObject reads object properties without losing the validation error order used by NestJS.
func DecodeObject(data []byte) (JSON, PropertyOrder, error) {
	orders := PropertyOrder{}
	decoder := json.NewDecoder(bytes.NewReader(data))
	value, err := decodeOrdered(decoder, orders, "")
	if err == io.EOF && len(bytes.TrimSpace(data)) == 0 {
		return JSON{}, orders, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, nil, fmt.Errorf("invalid trailing JSON")
	}
	object, ok := value.(map[string]interface{})
	if !ok {
		if array, ok := value.([]interface{}); ok {
			object = JSON{}
			for index, item := range array {
				object[strconv.Itoa(index)] = item
			}
			orders["#array"] = []string{}
			return object, orders, nil
		}
		return nil, nil, fmt.Errorf("JSON body must be an object or array")
	}
	return object, orders, nil
}
func decodeOrdered(decoder *json.Decoder, orders PropertyOrder, path string) (interface{}, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return token, nil
	}
	if delimiter == '[' {
		array := []interface{}{}
		for decoder.More() {
			value, err := decodeOrdered(decoder, orders, objectPath(path, strconv.Itoa(len(array))))
			if err != nil {
				return nil, err
			}
			array = append(array, value)
		}
		_, err = decoder.Token()
		return array, err
	}
	if delimiter != '{' {
		return nil, fmt.Errorf("unexpected JSON delimiter")
	}
	object := JSON{}
	keys := []string{}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		name := key.(string)
		value, err := decodeOrdered(decoder, orders, objectPath(path, name))
		if err != nil {
			return nil, err
		}
		if _, exists := object[name]; !exists {
			keys = append(keys, name)
		}
		object[name] = value
	}
	orders[path] = keys
	_, err = decoder.Token()
	return object, err
}

func stripPrototypeKeys(value interface{}) {
	switch value := value.(type) {
	case map[string]interface{}:
		delete(value, "__proto__")
		delete(value, "prototype")
		delete(value, "constructor")
		for _, child := range value {
			stripPrototypeKeys(child)
		}
	case []interface{}:
		for _, child := range value {
			stripPrototypeKeys(child)
		}
	}
}
