package platform

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const formParameterLimit = 1000
const formDepthLimit = 32
const minimumFormArrayLimit = 100

// formNode retains insertion order and sparse indexes until all bracket paths are merged.
type formNode struct {
	text       *string
	list       []*formNode
	fields     map[string]*formNode
	keys       []string
	overflow   bool
	maxIndex   int
	arrayLimit int
}

func formScalar(value string) *formNode { return &formNode{text: &value} }
func formMap() *formNode                { return &formNode{fields: map[string]*formNode{}} }

func (node *formNode) set(key string, value *formNode) {
	if _, exists := node.fields[key]; !exists {
		node.keys = append(node.keys, key)
	}
	node.fields[key] = value
	if node.overflow {
		if index, err := strconv.Atoi(key); err == nil && strconv.Itoa(index) == key {
			node.maxIndex = max(node.maxIndex, index)
		}
	}
}

func parseExtendedForm(raw, charset string) (JSON, PropertyOrder, error) {
	parameters := strings.Split(raw, "&")
	if len(parameters) > formParameterLimit {
		return nil, nil, errors.New("too many form parameters")
	}
	flat := collectFormValues(parameters, charset)
	root := formMap()
	for _, key := range flat.keys {
		if key == "" {
			continue
		}
		segments, err := formSegments(key)
		if err != nil {
			return nil, nil, err
		}
		child := bracketFormValue(segments, flat.fields[key], max(minimumFormArrayLimit, len(parameters)))
		root = mergeFormNodes(root, child)
	}
	order := PropertyOrder{}
	value, _ := root.materialize(order, "").(map[string]interface{})
	if value == nil {
		value = JSON{}
	}
	return value, order, nil
}

func collectFormValues(parameters []string, charset string) *formNode {
	flat := formMap()
	for _, parameter := range parameters {
		key, value, _ := strings.Cut(parameter, "=")
		key = decodeFormComponent(key, charset)
		child := formScalar(decodeFormComponent(value, charset))
		if previous, exists := flat.fields[key]; exists {
			child = mergeFormNodes(previous, child)
		}
		flat.set(key, child)
	}
	return flat
}

var percentOctet = regexp.MustCompile(`%[0-9a-fA-F]{2}`)

func decodeFormComponent(value, charset string) string {
	value = strings.ReplaceAll(value, "+", " ")
	if charset == "iso-8859-1" {
		return percentOctet.ReplaceAllStringFunc(value, func(octet string) string {
			code, _ := strconv.ParseUint(octet[1:], 16, 8)
			return string(rune(code))
		})
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || !utf8.ValidString(decoded) {
		return value
	}
	return decoded
}

func formSegments(key string) ([]string, error) {
	first := strings.IndexByte(key, '[')
	if first < 0 {
		return []string{key}, nil
	}
	segments := []string{}
	if first > 0 {
		segments = append(segments, key[:first])
	}
	for count := 0; first >= 0; count++ {
		if count >= formDepthLimit {
			return nil, errors.New("form nesting exceeds depth limit")
		}
		close := closingFormBracket(key, first)
		if close < 0 {
			return append(segments, "["+key[first:]+"]"), nil
		}
		segments = append(segments, key[first:close+1])
		next := strings.IndexByte(key[close+1:], '[')
		first = -1
		if next >= 0 {
			first = close + 1 + next
		}
	}
	return segments, nil
}

func closingFormBracket(key string, start int) int {
	level := 0
	for index := start; index < len(key); index++ {
		switch key[index] {
		case '[':
			level++
		case ']':
			level--
			if level == 0 {
				return index
			}
		}
	}
	return -1
}

func bracketFormValue(segments []string, value *formNode, arrayLimit int) *formNode {
	for index := len(segments) - 1; index >= 0; index-- {
		part := segments[index]
		if part == "[]" {
			if value.list == nil && !value.overflow {
				value = &formNode{list: []*formNode{value}, arrayLimit: arrayLimit}
			}
			continue
		}
		bracketed := strings.HasPrefix(part, "[") && strings.HasSuffix(part, "]")
		key := part
		if bracketed {
			key = part[1 : len(part)-1]
		}
		number, err := strconv.Atoi(key)
		isIndex := bracketed && err == nil && number >= 0 && strconv.Itoa(number) == key
		if isIndex && number < arrayLimit {
			items := make([]*formNode, number+1)
			items[number] = value
			value = &formNode{list: items, arrayLimit: arrayLimit}
			continue
		}
		parent := formMap()
		parent.overflow = isIndex
		if key != "__proto__" {
			parent.set(key, value)
		}
		value = parent
	}
	return value
}

func mergeFormNodes(target, source *formNode) *formNode {
	if target == nil {
		return source
	}
	if source == nil {
		return target
	}
	if target.text != nil || source.text != nil {
		return combineFormLeaves(target, source)
	}
	if target.list != nil && source.list != nil {
		return mergeFormArrays(target, source)
	}
	target, source = formArrayAsObject(target), formArrayAsObject(source)
	if source.overflow {
		target.overflow = true
		target.maxIndex = max(target.maxIndex, source.maxIndex)
	}
	for _, key := range source.keys {
		target.set(key, mergeFormNodes(target.fields[key], source.fields[key]))
	}
	return target
}

func combineFormLeaves(target, source *formNode) *formNode {
	if target.overflow {
		target.set(strconv.Itoa(target.maxIndex+1), source)
		return target
	}
	if source.overflow {
		result := formMap()
		result.overflow = true
		result.set("0", target)
		for _, key := range source.keys {
			index, _ := strconv.Atoi(key)
			result.set(strconv.Itoa(index+1), source.fields[key])
		}
		return result
	}
	if target.list != nil {
		target.list = append(target.list, source)
		return limitFormArray(target)
	}
	if source.list != nil {
		return &formNode{list: append([]*formNode{target}, source.list...)}
	}
	return &formNode{list: []*formNode{target, source}}
}

func mergeFormArrays(target, source *formNode) *formNode {
	for index, item := range source.list {
		if item == nil {
			continue
		}
		if index >= len(target.list) {
			target.list = append(target.list, make([]*formNode, index-len(target.list)+1)...)
		}
		previous := target.list[index]
		if previous == nil {
			target.list[index] = item
		} else if previous.text == nil && item.text == nil {
			target.list[index] = mergeFormNodes(previous, item)
		} else {
			target.list = append(target.list, item)
		}
	}
	return limitFormArray(target)
}

func limitFormArray(node *formNode) *formNode {
	if node.arrayLimit == 0 || len(node.list) <= node.arrayLimit {
		return node
	}
	result := formArrayAsObject(node)
	result.overflow = true
	result.maxIndex = len(node.list) - 1
	return result
}

func formArrayAsObject(node *formNode) *formNode {
	if node.list == nil {
		return node
	}
	result := formMap()
	for index, child := range node.list {
		if child != nil {
			result.set(strconv.Itoa(index), child)
		}
	}
	return result
}

func (node *formNode) materialize(order PropertyOrder, path string) interface{} {
	if node.text != nil {
		return *node.text
	}
	if node.list != nil {
		result := []interface{}{}
		for _, child := range node.list {
			if child != nil {
				result = append(result, child.materialize(order, objectPath(path, strconv.Itoa(len(result)))))
			}
		}
		return result
	}
	result := JSON{}
	order[path] = node.keys
	for _, key := range node.keys {
		result[key] = node.fields[key].materialize(order, objectPath(path, key))
	}
	return result
}
