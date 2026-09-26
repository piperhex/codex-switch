package mediarelay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// Explicit opt-in: starts a disposable coturn container and the real browser sender/viewer fixture.
// No production credentials, databases, devices or relay configuration are used.
func TestCoturnBrowserVideoAndControls(t *testing.T) {
	if os.Getenv("COTURN_INTEGRATION") != "1" {
		t.Skip("set COTURN_INTEGRATION=1 with Docker and Edge installed")
	}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	name := "codex-desktop-relay-test"
	args := []string{"run", "--detach", "--name", name,
		"-p", "127.0.0.1:3488:3478/udp", "-p", "127.0.0.1:3488:3478/tcp",
		"-p", "127.0.0.1:50000-50019:50000-50019/udp", "coturn/coturn:4.18.0-r0",
		"--realm=" + testConfig.Realm, "--use-auth-secret", "--static-auth-secret=" + testConfig.Secret,
		"--listening-ip=0.0.0.0", "--external-ip=127.0.0.1", "--min-port=50000", "--max-port=50019",
		"--no-tls", "--no-tcp-relay", "--allow-loopback-peers", "--log-file=stdout", "--verbose",
		"--relay-ip=127.0.0.1", "--relay-threads=1", "--max-allocate-lifetime=10"}
	if output, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
		t.Fatalf("start test coturn: %v: %s", err, output)
	}
	t.Cleanup(func() {
		if t.Failed() {
			if output, err := exec.Command("docker", "logs", "--tail", "65", name).CombinedOutput(); err == nil {
				t.Logf("coturn diagnostics: %s", output)
			}
		}
		if output, err := exec.Command("docker", "rm", "--force", name).CombinedOutput(); err != nil {
			t.Errorf("stop test coturn: %v: %s", err, output)
		}
	})
	for _, protocol := range []string{"udp", "tcp", "tls"} {
		t.Run(protocol, func(t *testing.T) { browserRelay(t, protocol) })
	}
}

func browserRelay(t *testing.T, protocol string) {
	t.Helper()
	var bytes atomic.Int64
	config := testConfig
	testCA := ""
	// Fixed isolated port avoids Windows' independently reserved TCP/UDP ephemeral ranges.
	config.Listen, config.Backend = "127.0.0.1:3489", "127.0.0.1:3488"
	if protocol == "tls" {
		certificate := testCertificate(t)
		block, _ := pem.Decode([]byte(certificate["cert"]))
		testCA = base64.StdEncoding.EncodeToString(block.Bytes)
		manager := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := json.NewEncoder(w).Encode(certificate); err != nil {
				t.Error(err)
			}
		}))
		defer manager.Close()
		config.TLSListen, config.TLSCertURL = "127.0.0.1:0", manager.URL
	}
	proxy, err := Start(config, func(_ context.Context, owner string, size int, write func() error) error {
		if owner != testOwner {
			t.Error("incorrect traffic owner")
		}
		if err := write(); err != nil {
			return err
		}
		bytes.Add(int64(size))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	credentials := Issue(config.Secret, testOwner, time.Now().Add(12*time.Second))
	address := "turn:" + proxy.udp.LocalAddr().String() + "?transport=" + protocol
	if protocol == "tls" {
		address = "turns:" + proxy.tls.Addr().String() + "?transport=tcp"
	}
	ice, err := json.Marshal([]map[string]any{{"urls": []string{address},
		"username": credentials.Username, "credential": credentials.Credential}})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(directory, "../../../.."))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "node_modules/@playwright/test/cli.js"),
		"test", "--config=playwright.remote-desktop.config.ts", "--project=desktop")
	command.Dir = filepath.Join(root, "apps/web")
	command.Env = append(os.Environ(), "DESKTOP_RELAY_TEST_ICE="+string(ice), "DESKTOP_RELAY_TEST_PROTOCOL="+protocol)
	if output, err := command.CombinedOutput(); err != nil {
		t.Logf("metered bytes before failure: %d", bytes.Load())
		t.Fatalf("WebRTC relay failed: %v: %s", err, output)
	}
	if os.Getenv("COTURN_NATIVE_INTEGRATION") == "1" {
		credentials = Issue(config.Secret, testOwner, time.Now().Add(5*time.Minute))
		ice, err = json.Marshal([]map[string]any{{"urls": []string{address},
			"username": credentials.Username, "credential": credentials.Credential}})
		if err != nil {
			t.Fatal(err)
		}
		native := exec.CommandContext(ctx, "cargo", "test", "--manifest-path",
			filepath.Join(root, "apps/desktop/src-tauri/Cargo.toml"), "--test", "codex_switch_lib_tests",
			"native_capture_reaches_a_real_browser_decoder", "--", "--ignored", "--nocapture")
		native.Dir = root
		native.Env = append(os.Environ(), "CSW_NATIVE_TEST_ICE="+string(ice))
		if testCA != "" {
			native.Env = append(native.Env, "CSW_NATIVE_TEST_CA_BASE64="+testCA)
		}
		if output, err := native.CombinedOutput(); err != nil {
			t.Fatalf("native relay failed: %v: %s", err, output)
		} else {
			t.Logf("native relay: %s", output)
		}
	}
	if bytes.Load() < 10000 {
		t.Fatalf("video traffic not accounted: %d bytes", bytes.Load())
	}
	t.Logf("video/control passed over TURN/%s; metered %d bytes", protocol, bytes.Load())
}
