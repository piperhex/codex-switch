package platform

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/andybalholm/brotli"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/encoding/unicode/utf32"
)

const maxRequestBytes = 12 * 1024 * 1024

func decodedRequestBody(request *http.Request) ([]byte, string, error) {
	_, parameters, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil {
		return nil, "", err
	}
	charset := strings.ToLower(parameters["charset"])
	if charset == "" {
		charset = "utf-8"
	}
	stream, err := requestContentStream(request)
	if err != nil {
		return nil, charset, err
	}
	defer stream.Close()
	body, err := io.ReadAll(io.LimitReader(stream, maxRequestBytes+1))
	if err != nil || len(body) > maxRequestBytes {
		return nil, charset, errors.New("invalid request body")
	}
	body, err = decodeCharset(body, charset)
	return body, charset, err
}

func requestContentStream(request *http.Request) (io.ReadCloser, error) {
	switch strings.ToLower(request.Header.Get("Content-Encoding")) {
	case "", "identity":
		return io.NopCloser(request.Body), nil
	case "gzip":
		return gzip.NewReader(request.Body)
	case "deflate":
		return zlib.NewReader(request.Body)
	case "br":
		return io.NopCloser(brotli.NewReader(request.Body)), nil
	default:
		return nil, errors.New("unsupported content encoding")
	}
}

func decodeCharset(body []byte, charset string) ([]byte, error) {
	var codec encoding.Encoding
	switch charset {
	case "utf-8":
		codec = unicode.UTF8
	case "utf-16", "utf-16le":
		codec = unicode.UTF16(unicode.LittleEndian, unicode.UseBOM)
	case "utf-16be":
		codec = unicode.UTF16(unicode.BigEndian, unicode.UseBOM)
	case "utf-32", "utf-32le":
		codec = utf32.UTF32(utf32.LittleEndian, utf32.UseBOM)
	case "utf-32be":
		codec = utf32.UTF32(utf32.BigEndian, utf32.UseBOM)
	case "iso-8859-1":
		codec = charmap.ISO8859_1
	default:
		return nil, errors.New("unsupported charset")
	}
	decoded, err := codec.NewDecoder().Bytes(body)
	return bytes.TrimPrefix(decoded, []byte("\xef\xbb\xbf")), err
}
