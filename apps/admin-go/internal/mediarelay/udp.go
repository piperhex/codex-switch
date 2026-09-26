package mediarelay

import (
	"net"
	"time"
)

func (p *Proxy) readUDP() {
	defer p.workers.Done()
	buffer := make([]byte, maxFrameBytes)
	for {
		n, address, err := p.udp.ReadFrom(buffer)
		if err != nil {
			return
		}
		if _, _, err = decode(buffer[:n]); err != nil {
			continue
		}
		c := p.udpConnection(address)
		if c == nil {
			continue
		}
		packet := append([]byte(nil), buffer[:n]...)
		select {
		case c.queue <- packet:
		case <-c.done:
		default: /* Bound memory under congestion. */
		}
	}
}

func (p *Proxy) udpConnection(address net.Addr) *connection {
	key := "udp:" + address.String()
	ip, _, err := net.SplitHostPort(address.String())
	if err != nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if c := p.connections[key]; c != nil {
		return c
	}
	if !p.allowed(ip) {
		return nil
	}
	// UDP dial creates a local socket; backend DNS is resolved once at configuration time.
	backend, err := net.DialUDP("udp", nil, p.backend)
	if err != nil {
		return nil
	}
	c := &connection{backend: backend, queue: make(chan []byte, udpQueueSize), done: make(chan struct{}), ip: ip}
	p.connections[key] = c
	p.workers.Add(2)
	go p.sendUDP(key, c)
	go p.receiveUDP(key, c, address)
	return c
}

func (p *Proxy) sendUDP(key string, c *connection) {
	defer p.workers.Done()
	defer p.remove(key, c)
	for {
		select {
		case <-c.done:
			return
		case packet := <-c.queue:
			err := p.forward(&c.gate, packet, true, func() error {
				if err := c.backend.SetWriteDeadline(time.Now().Add(connectTimeout)); err != nil {
					return err
				}
				return writeFrame(c.backend, packet)
			})
			if err != nil {
				return
			}
		}
	}
}

func (p *Proxy) receiveUDP(key string, c *connection, address net.Addr) {
	defer p.workers.Done()
	defer p.remove(key, c)
	buffer := make([]byte, maxFrameBytes)
	for {
		if err := c.backend.SetReadDeadline(time.Now().Add(idleTimeout)); err != nil {
			return
		}
		n, err := c.backend.Read(buffer)
		if err != nil {
			return
		}
		err = p.forward(&c.gate, buffer[:n], false, func() error {
			_, err := p.udp.WriteTo(buffer[:n], address)
			return err
		})
		if err != nil {
			return
		}
	}
}
