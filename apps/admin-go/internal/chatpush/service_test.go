package chatpush

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
)

func TestDisabledPushDoesNotAccessDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	deps := &platform.Dependencies{Config: platform.Config{}, Authenticate: func(*gin.Context) (*platform.Principal, error) {
		return &platform.Principal{ID: "owner"}, nil
	}}
	close := Register(router, deps)
	defer close()
	status := httptest.NewRecorder()
	router.ServeHTTP(status, httptest.NewRequest("GET", "/chat-push/status", nil))
	if status.Code != 200 || !strings.Contains(status.Body.String(), `"enabled":false`) {
		t.Fatal(status.Body.String())
	}
	for _, path := range []string{"/chat-push/subscription", "/chat-push/events"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		if response.Code != 503 {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
}

func TestNotificationsContainOnlyRoutingMetadata(t *testing.T) {
	entry := delivery{DeviceID: "device", ThreadID: "thread", EventID: "turn", Kind: "attention"}
	payload := notification(entry, subscription{Token: "ExponentPushToken[testtoken123]", Account: strings.Repeat("a", 64)})
	data := payload["data"].(map[string]interface{})
	if payload["title"] != "Codex 需要你确认" || data["threadId"] != "thread" || len(data) != 6 {
		t.Fatal(payload)
	}
	if _, exists := data["text"]; exists {
		t.Fatal("chat content must never enter a push")
	}
	if !(event{DeviceID: "device", ThreadID: "thread", EventID: "turn", Kind: "completed"}).valid() {
		t.Fatal("valid event")
	}
	for _, kind := range []string{"text", "interrupted", ""} {
		if (event{DeviceID: "device", ThreadID: "thread", EventID: "turn", Kind: kind}).valid() {
			t.Fatal(kind)
		}
	}
}

func TestExpoRequestUsesProviderCredentialAndValidatesHTTPStatus(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer server-test-secret" || r.URL.Path != "/send" {
			t.Error("invalid provider request")
		}
		var value map[string]interface{}
		if json.NewDecoder(r.Body).Decode(&value) != nil {
			t.Error("invalid JSON")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"data":{"status":"ok","id":"receipt"}}`))
	}))
	defer server.Close()
	service := &service{deps: &platform.Dependencies{Config: platform.Config{"EXPO_PUSH_ACCESS_TOKEN": "server-test-secret"}},
		client: server.Client(), endpoint: server.URL + "/"}
	var result struct {
		Data ticket `json:"data"`
	}
	if err := service.post(context.Background(), "send", map[string]string{"to": "test"}, &result); err != nil {
		t.Fatal(err)
	}
	if result.Data.ID != "receipt" {
		t.Fatal(result)
	}
	status = http.StatusTooManyRequests
	if service.post(context.Background(), "send", map[string]string{}, &result) == nil {
		t.Fatal("provider failure ignored")
	}
}
