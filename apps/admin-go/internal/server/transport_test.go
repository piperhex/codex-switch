package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func transportRouter() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.RedirectTrailingSlash = false
	router.UseRawPath = true
	router.Use(transportHeaders(), recovery(), platform.RequestBodyParser(), cors())
	router.GET("/items/:id", func(c *gin.Context) { c.String(200, c.Param("id")) })
	router.NoRoute(notFound)
	return router
}

func responseFor(handler http.Handler, method, path string, headers http.Header) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	request.Header = headers
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestRouteCompatibility(t *testing.T) {
	handler := Handler(transportRouter())
	cases := []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/ITEMS/a/", "a", 200},
		{"GET", "/items/%2F", "/", 200},
		{"HEAD", "/ITEMS/a/", "", 200},
		{"GET", "/items/a//", "Cannot GET /items/a//", 404},
		{"GET", "/%69tems/a", "Cannot GET /%69tems/a", 404},
		{"POST", "/ITEMS/a/", "Cannot POST /ITEMS/a/", 404},
	}
	for _, item := range cases {
		t.Run(item.method+item.path, func(t *testing.T) {
			response := responseFor(handler, item.method, item.path, http.Header{})
			if response.Code != item.status || !strings.Contains(response.Body.String(), item.body) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
			if item.method == "HEAD" && (response.Body.Len() != 0 || response.Header().Get("Content-Length") != "1") {
				t.Fatalf("HEAD = %s, headers = %v", response.Body.String(), response.Header())
			}
		})
	}
	missing := responseFor(handler, "HEAD", "/missing?x=1", http.Header{})
	get := responseFor(handler, "GET", "/missing?x=1", http.Header{})
	if missing.Header().Get("Content-Length") != strconv.Itoa(get.Body.Len()+1) {
		t.Fatal("missing HEAD must use the original method in its omitted error body")
	}
}

func TestETagConditions(t *testing.T) {
	handler := Handler(transportRouter())
	initial := responseFor(handler, "GET", "/items/a", http.Header{})
	etag := initial.Header().Get("ETag")
	if etag != `W/"1-hvfkN/qlp/zhXR3cuerq6jd2Z7g"` {
		t.Fatalf("Express entity ETag = %q", etag)
	}
	for _, method := range []string{"GET", "HEAD"} {
		for _, tag := range []string{etag, strings.TrimPrefix(etag, "W/"), `"unmatched", ` + etag, "*"} {
			response := responseFor(handler, method, "/items/a", http.Header{"If-None-Match": {tag}})
			if response.Code != 304 || response.Body.Len() != 0 || response.Header().Get("Content-Type") != "" {
				t.Fatalf(
					"%s condition %s: %d %s %v",
					method,
					tag,
					response.Code,
					response.Body.String(),
					response.Header(),
				)
			}
		}
	}
	response := responseFor(
		handler,
		"GET",
		"/items/a",
		http.Header{"If-None-Match": {etag}, "Cache-Control": {"no-cache"}},
	)
	if response.Code != 200 || response.Body.String() != "a" {
		t.Fatalf("no-cache condition = %d %s", response.Code, response.Body.String())
	}
}

func TestPreflightWireHeaders(t *testing.T) {
	server := httptest.NewServer(Handler(transportRouter()))
	defer server.Close()
	request, err := http.NewRequest("OPTIONS", server.URL+"/missing", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "https://fixture.example")
	request.Header.Set("Access-Control-Request-Headers", "Authorization, Content-Type")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 204 || response.Header.Get("Content-Length") != "0" {
		t.Fatalf("wire status = %d, headers = %v", response.StatusCode, response.Header)
	}
	if response.Header.Get("Access-Control-Allow-Origin") != request.Header.Get("Origin") ||
		response.Header.Get("Access-Control-Allow-Headers") != request.Header.Get("Access-Control-Request-Headers") {
		t.Fatalf("preflight headers = %v", response.Header)
	}
	data, err := io.ReadAll(response.Body)
	if err != nil || len(data) != 0 {
		t.Fatalf("preflight body = %s, %v", data, err)
	}
}

func TestParserFailurePrecedesCORS(t *testing.T) {
	handler := Handler(transportRouter())
	for _, method := range []string{"POST", "OPTIONS"} {
		request := httptest.NewRequest(method, "/items/a", strings.NewReader("{"))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", "https://fixture.example")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 404 || response.Header().Get("Vary") != "" ||
			response.Header().Get("Access-Control-Allow-Origin") != "" ||
			response.Header().Get("Access-Control-Allow-Credentials") != "" {
			t.Fatalf("%s malformed JSON = %d %v", method, response.Code, response.Header())
		}
	}
}

func staticFixture(t *testing.T) http.Handler {
	t.Helper()
	directory := t.TempDir()
	file := filepath.Join(directory, "admin.html")
	if err := os.WriteFile(file, []byte("fixture HTML"), 0600); err != nil {
		t.Fatal(err)
	}
	modified := time.Unix(1700000000, 900000)
	if err := os.Chtimes(file, modified, modified); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0700); err != nil {
		t.Fatal(err)
	}
	router := transportRouter()
	staticRoutes(router, directory)
	return Handler(router)
}

func TestStaticCachingAndRanges(t *testing.T) {
	handler := staticFixture(t)
	initial := responseFor(handler, "GET", "/admin", http.Header{})
	if initial.Header().Get("ETag") != `W/"c-18bcfe56801"` {
		t.Fatalf("rounded static ETag = %s", initial.Header().Get("ETag"))
	}
	rangeResponse := responseFor(handler, "GET", "/admin.html", http.Header{"Range": {"bytes=0-3"}})
	if rangeResponse.Code != 206 || rangeResponse.Body.String() != "fixt" {
		t.Fatalf("range = %d %s", rangeResponse.Code, rangeResponse.Body.String())
	}
	conditional := responseFor(handler, "GET", "/admin", http.Header{"If-None-Match": {initial.Header().Get("ETag")}})
	if conditional.Code != 304 || conditional.Body.Len() != 0 {
		t.Fatalf("static condition = %d %s", conditional.Code, conditional.Body.String())
	}
	redirect := responseFor(handler, "GET", "/assets?x=1&y=2", http.Header{})
	if redirect.Code != 301 || redirect.Header().Get("Location") != "/assets/?x=1&y=2" ||
		redirect.Header().Get("ETag") != "" || !strings.Contains(redirect.Body.String(), "x=1&amp;y=2") {
		t.Fatalf("directory redirect = %d %v %s", redirect.Code, redirect.Header(), redirect.Body.String())
	}
}

func TestStaticRangeErrorCompatibility(t *testing.T) {
	handler := staticFixture(t)
	cases := []struct {
		rangeHeader string
		status      int
		body        string
	}{
		{"bytes=99999-", 416, "Range Not Satisfiable"},
		{"bytes=bad", 200, "fixture HTML"},
		{"bytes=1-0", 416, "Range Not Satisfiable"},
		{"bytes=0-2,5-7", 200, "fixture HTML"},
		{"bytes=0-2,2-5", 206, "fixtur"},
		{"bytes=-3", 206, "TML"},
		{"bytes=-999", 416, "Range Not Satisfiable"},
		{"bytes=0-999999999999999999999999", 206, "fixture HTML"},
	}
	for _, item := range cases {
		response := responseFor(handler, "GET", "/admin.html", http.Header{"Range": {item.rangeHeader}})
		if response.Code != item.status || !strings.Contains(response.Body.String(), item.body) {
			t.Fatalf("range %s = %d %s", item.rangeHeader, response.Code, response.Body.String())
		}
	}
}

func TestStaticPreconditionCompatibility(t *testing.T) {
	handler := staticFixture(t)
	initial := responseFor(handler, "GET", "/admin", http.Header{})
	etag := initial.Header().Get("ETag")
	for _, match := range []string{etag, strings.TrimPrefix(etag, "W/"), "*"} {
		response := responseFor(handler, "GET", "/admin", http.Header{"If-Match": {match}})
		if response.Code != 200 {
			t.Fatalf("matching weak tag %s = %d", match, response.Code)
		}
	}
	failed := responseFor(handler, "GET", "/admin", http.Header{"If-Match": {`"different"`}})
	if failed.Code != 412 || !strings.Contains(failed.Body.String(), `"message":"Precondition Failed"`) {
		t.Fatalf("failed precondition = %d %s", failed.Code, failed.Body.String())
	}
	conditional := responseFor(handler, "GET", "/admin", http.Header{"If-None-Match": {etag}, "Range": {"bytes=999-"}})
	if conditional.Code != 304 {
		t.Fatalf("cache validator precedes Range = %d", conditional.Code)
	}
}
