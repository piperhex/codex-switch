package devices

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

const heartbeatInterval = 25 * time.Second
const authTimeout = 10 * time.Second
const chatBufferLimit = 2 * 1024 * 1024

type outputFrame struct {
	bytes []byte
	sent  func(int)
}
type peer struct {
	conn      *websocket.Conn
	queue     chan outputFrame
	done      chan struct{}
	closeOnce sync.Once
	buffered  atomic.Int64
	alive     atomic.Bool
	closed    atomic.Bool
}

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func newPeer(conn *websocket.Conn) *peer {
	client := &peer{conn: conn, queue: make(chan outputFrame, 1024), done: make(chan struct{})}
	client.alive.Store(true)
	conn.SetPongHandler(func(string) error { client.alive.Store(true); return nil })
	go client.writeLoop()
	return client
}

func (p *peer) send(value interface{}, sent func(int)) {
	if p == nil || p.closed.Load() {
		return
	}
	if p.buffered.Load() > chatBufferLimit {
		p.close(4008, "Connection is too slow")
		return
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(platform.JSONValue(value))
	if err != nil {
		p.close(4001, "Invalid message")
		return
	}
	data := bytes.TrimSuffix(buffer.Bytes(), []byte("\n"))
	p.buffered.Add(int64(len(data)))
	select {
	case p.queue <- outputFrame{data, sent}:
	default:
		p.buffered.Add(-int64(len(data)))
		p.close(4008, "Connection is too slow")
	}
}

func (p *peer) writeLoop() {
	timer := time.NewTicker(heartbeatInterval)
	defer timer.Stop()
	for {
		select {
		case <-p.done:
			return
		case frame := <-p.queue:
			if err := p.conn.SetWriteDeadline(time.Now().Add(heartbeatInterval)); err != nil {
				p.terminate()
				return
			}
			err := p.conn.WriteMessage(websocket.TextMessage, frame.bytes)
			p.buffered.Add(-int64(len(frame.bytes)))
			if err != nil {
				p.terminate()
				return
			}
			if frame.sent != nil {
				frame.sent(len(frame.bytes))
			}
		case <-timer.C:
			if !p.alive.Swap(false) {
				p.terminate()
				return
			}
			if err := p.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(time.Second)); err != nil {
				p.terminate()
				return
			}
		}
	}
}

func (p *peer) close(code int, reason string) {
	p.closeOnce.Do(func() {
		p.closed.Store(true)
		// A failed close frame means the socket is already unusable; Close still releases it.
		_ = p.conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(code, reason),
			time.Now().Add(time.Second),
		)
		_ = p.conn.Close()
		close(p.done)
	})
}

func (p *peer) terminate() {
	p.closeOnce.Do(func() { p.closed.Store(true); _ = p.conn.Close(); close(p.done) })
}

func parseObject(data []byte) (platform.JSON, error) {
	var object platform.JSON
	if err := json.Unmarshal(data, &object); err != nil {
		return nil, err
	}
	if object == nil {
		return nil, errors.New("invalid message")
	}
	return object, nil
}

func socketIdentity(deps *platform.Dependencies, token string) (string, time.Time, error) {
	secret := strings.TrimSpace(deps.Config.Get("KONG_JWT_SECRET", ""))
	if secret == "" {
		secret = "change-me-kong-jwt-secret"
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (interface{}, error) { return []byte(secret), nil },
		jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}))
	if err != nil {
		return "", time.Time{}, err
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return "", time.Time{}, errors.New("invalid subject")
	}
	var count int64
	if err := deps.DB.Table("users").Where("id = ? AND disabled = false", sub).Count(&count).Error; err != nil {
		return "", time.Time{}, err
	}
	if count != 1 {
		return "", time.Time{}, errors.New("user is unavailable")
	}
	expires := time.Time{}
	if date, _ := claims.GetExpirationTime(); date != nil {
		expires = date.Time
	}
	return sub, expires, nil
}
