package mediarelay

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pion/stun/v3"
)

const testOwner = "ad35d81d-ab01-4669-a5bd-f14c4bca7edf"

var testConfig = Config{Secret: "test-only-secret-with-at-least-32-bytes", Realm: "test.codex"}

func authFrame(t *testing.T, credentials Credentials) []byte {
	t.Helper()
	message, err := stun.Build(stun.NewType(stun.MethodAllocate, stun.ClassRequest), stun.TransactionID,
		stun.NewUsername(credentials.Username), stun.NewRealm(testConfig.Realm), stun.NewNonce("test-nonce"),
		stun.NewLongTermIntegrity(credentials.Username, testConfig.Realm, credentials.Credential))
	if err != nil {
		t.Fatal(err)
	}
	return message.Raw
}

func TestAuthenticationRejectsExpiredForgedAndCrossAccountCredentials(t *testing.T) {
	valid := Issue(testConfig.Secret, testOwner, time.Now().Add(time.Minute))
	forged := valid
	forged.Credential = "wrong-password"
	cases := []struct {
		name        string
		credentials Credentials
		established string
		valid       bool
	}{
		{"valid", valid, "", true},
		{"forged", forged, "", false},
		{"expired", Issue(testConfig.Secret, testOwner, time.Now().Add(-time.Second)), "", false},
		{"cross-account", valid, "34d9ee04-996c-4017-84f2-32fa0c302503", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := gate{owner: tc.established}
			owner, _, err := g.inspect(authFrame(t, tc.credentials), testConfig, true)
			if (err == nil) != tc.valid {
				t.Fatalf("authentication = %v", err)
			}
			if tc.valid && owner != testOwner {
				t.Fatal("wrong billed owner")
			}
		})
	}
}

func TestMediaCannotBypassAuthenticationOrQuotaInEitherDirection(t *testing.T) {
	frame := []byte{0x40, 1, 0, 3, 10, 20, 30}
	g := &gate{}
	writes, billed := 0, 0
	blocked := false
	quota := errors.New("quota exhausted")
	p := &Proxy{config: testConfig, transmit: func(_ context.Context, owner string, bytes int, write func() error) error {
		if owner != testOwner {
			t.Fatal("wrong billed account")
		}
		if blocked {
			return quota
		}
		billed += bytes
		return write()
	}}
	write := func() error { writes++; return nil }
	if err := p.forward(g, frame, true, write); !errors.Is(err, errAuthentication) {
		t.Fatal(err)
	}
	if _, _, err := g.inspect(authFrame(t, Issue(testConfig.Secret, testOwner, time.Now().Add(time.Minute))),
		testConfig, true); err != nil {
		t.Fatal(err)
	}
	for _, direction := range []bool{true, false} {
		if err := p.forward(g, frame, direction, write); err != nil {
			t.Fatal(err)
		}
	}
	blocked = true
	for _, direction := range []bool{true, false} {
		if err := p.forward(g, frame, direction, write); !errors.Is(err, quota) {
			t.Fatal(err)
		}
	}
	if writes != 2 || billed != len(frame)*2 {
		t.Fatalf("writes=%d billed=%d", writes, billed)
	}
}

func TestSendAndDataIndicationsAreMetered(t *testing.T) {
	for _, method := range []stun.Method{stun.MethodSend, stun.MethodData} {
		message := stun.MustBuild(stun.NewType(method, stun.ClassIndication), stun.TransactionID,
			stun.RawAttribute{Type: stun.AttrData, Value: []byte("encrypted media")})
		g := gate{owner: testOwner}
		owner, media, err := g.inspect(message.Raw, testConfig, method == stun.MethodSend)
		if err != nil || !media || owner != testOwner {
			t.Fatalf("media bypass: %v", err)
		}
	}
}

func TestUnauthenticatedControlFloodIsBounded(t *testing.T) {
	message := stun.MustBuild(stun.BindingRequest, stun.TransactionID)
	g := gate{}
	for i := 0; i < controlFramesPerSecond; i++ {
		if _, _, err := g.inspect(message.Raw, testConfig, true); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := g.inspect(message.Raw, testConfig, true); !errors.Is(err, errProtocol) {
		t.Fatal(err)
	}
}
