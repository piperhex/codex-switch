package mediarelay

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/pion/stun/v3"
)

const controlFramesPerSecond = 120
const controlBytesPerSecond = 128 * 1024
const accountingTimeout = 3 * time.Second

type Transmit func(context.Context, string, int, func() error) error

type gate struct {
	mu            sync.Mutex
	owner         string
	window        time.Time
	frames, bytes int
}

func (g *gate) inspect(frame []byte, config Config, fromClient bool) (string, bool, error) {
	message, media, err := decode(frame)
	if err != nil {
		return "", false, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if media {
		if g.owner == "" {
			return "", false, errAuthentication
		}
		return g.owner, true, nil
	}
	if err := g.controlLimit(len(frame)); err != nil {
		return "", false, err
	}
	if fromClient && message.Contains(stun.AttrUsername) {
		owner, err := authenticate(message, config, g.owner)
		if err != nil {
			return "", false, err
		}
		g.owner = owner
	}
	return g.owner, false, nil
}

func (g *gate) controlLimit(size int) error {
	if time.Since(g.window) >= time.Second {
		g.window = time.Now()
		g.frames = 0
		g.bytes = 0
	}
	g.frames++
	g.bytes += size
	if g.frames > controlFramesPerSecond || g.bytes > controlBytesPerSecond {
		return errProtocol
	}
	return nil
}

func (p *Proxy) forward(g *gate, frame []byte, fromClient bool, write func() error) error {
	owner, media, err := g.inspect(frame, p.config, fromClient)
	if err != nil {
		slog.Debug("media relay frame rejected", "from_client", fromClient, "error", err)
		return err
	}
	if !media {
		return write()
	}
	ctx, cancel := context.WithTimeout(context.Background(), accountingTimeout)
	defer cancel()
	// No socket write occurs when accounting or quota checks fail. SRTP remains end-to-end encrypted.
	return p.transmit(ctx, owner, len(frame), write)
}
