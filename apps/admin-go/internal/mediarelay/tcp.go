package mediarelay

import (
	"net"
	"time"
)

func (p *Proxy) accept(listener net.Listener) {
	defer p.workers.Done()
	for {
		client, err := listener.Accept()
		if err != nil {
			return
		}
		p.startTCP(client)
	}
}

func (p *Proxy) startTCP(client net.Conn) {
	key := "tcp:" + client.LocalAddr().String() + ":" + client.RemoteAddr().String()
	ip, _, err := net.SplitHostPort(client.RemoteAddr().String())
	if err != nil {
		_ = client.Close()
		return
	}
	p.mu.Lock()
	allowed := p.allowed(ip)
	p.mu.Unlock()
	if !allowed {
		_ = client.Close()
		return
	}
	backend, err := net.DialTimeout("tcp", p.backend.String(), connectTimeout)
	if err != nil {
		_ = client.Close()
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.allowed(ip) {
		_ = backend.Close()
		_ = client.Close()
		return
	}
	c := &connection{client: client, backend: backend, done: make(chan struct{}), ip: ip}
	p.connections[key] = c
	p.workers.Add(2)
	go p.copyTCP(key, c, true)
	go p.copyTCP(key, c, false)
}

func (p *Proxy) copyTCP(key string, c *connection, fromClient bool) {
	defer p.workers.Done()
	defer p.remove(key, c)
	source, target := c.backend, c.client
	if fromClient {
		source, target = c.client, c.backend
	}
	for {
		if err := source.SetReadDeadline(time.Now().Add(idleTimeout)); err != nil {
			return
		}
		frame, err := readFrame(source)
		if err != nil {
			return
		}
		err = p.forward(&c.gate, frame, fromClient, func() error {
			if err := target.SetWriteDeadline(time.Now().Add(connectTimeout)); err != nil {
				return err
			}
			return writeFrame(target, frame)
		})
		if err != nil {
			return
		}
	}
}
