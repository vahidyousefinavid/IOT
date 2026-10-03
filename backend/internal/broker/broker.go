// Package broker is the platform's own MQTT connection to EMQX.
package broker

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
)

// SharedTopic uses an EMQX shared subscription: with N API replicas each
// message is delivered to exactly one of them, so ingestion scales out.
const SharedTopic = "$share/core/hb/#"

type Client struct{ c mqtt.Client }

type Handler func(topic string, payload []byte)

func Connect(ctx context.Context, url, user, password string, onMessage Handler) (*Client, error) {
	opts := mqtt.NewClientOptions().
		AddBroker(url).
		SetClientID("core-" + uuid.NewString()[:8]).
		SetUsername(user).
		SetPassword(password).
		SetCleanSession(true).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(2 * time.Second).
		SetOrderMatters(false).
		SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})

	// (Re)subscribe on every connect, since clean sessions drop subscriptions.
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		slog.Info("mqtt connected")
		t := c.Subscribe(SharedTopic, 1, func(_ mqtt.Client, m mqtt.Message) {
			onMessage(m.Topic(), m.Payload())
		})
		if t.WaitTimeout(10*time.Second) && t.Error() != nil {
			slog.Error("mqtt subscribe failed", "err", t.Error())
		}
	})
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) { slog.Warn("mqtt connection lost", "err", err) })

	c := mqtt.NewClient(opts)
	t := c.Connect()
	select {
	case <-t.Done():
		if t.Error() != nil {
			return nil, fmt.Errorf("mqtt connect: %w", t.Error())
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return &Client{c: c}, nil
}

func (b *Client) Publish(topic string, payload []byte) error {
	t := b.c.Publish(topic, 1, false, payload)
	if !t.WaitTimeout(5 * time.Second) {
		return fmt.Errorf("mqtt publish timeout")
	}
	return t.Error()
}

func (b *Client) Connected() bool { return b.c.IsConnectionOpen() }

func (b *Client) Close() { b.c.Disconnect(500) }
