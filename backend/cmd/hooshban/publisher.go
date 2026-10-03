package main

import (
	"errors"
	"sync/atomic"

	"hooshban/backend/internal/broker"
)

// lazyPublisher lets the API start before the broker is reachable; commands
// fail with 502 until the MQTT connection is up.
type lazyPublisher struct{ c atomic.Pointer[broker.Client] }

var errNoBroker = errors.New("mqtt not connected")

func (p *lazyPublisher) set(c *broker.Client) { p.c.Store(c) }

func (p *lazyPublisher) Publish(topic string, payload []byte) error {
	c := p.c.Load()
	if c == nil {
		return errNoBroker
	}
	return c.Publish(topic, payload)
}

func (p *lazyPublisher) connected() bool {
	c := p.c.Load()
	return c != nil && c.Connected()
}

func (p *lazyPublisher) close() {
	if c := p.c.Load(); c != nil {
		c.Close()
	}
}
