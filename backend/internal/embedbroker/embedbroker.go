// Package embedbroker runs an MQTT broker inside the API process.
//
// It is meant for single-home / single-machine installs and small servers,
// where a separate EMQX (≈250 MB RAM) is overkill. Authentication and topic
// authorisation reuse mqttauth, so devices get exactly the same isolation as
// with EMQX: one identity per device, confined to its own topic root.
package embedbroker

import (
	"bytes"
	"context"
	"crypto/tls"
	"log/slog"

	mqtt "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/listeners"
	"github.com/mochi-mqtt/server/v2/packets"

	"hooshban/backend/internal/mqttauth"
)

type Config struct {
	Addr    string // plain MQTT, e.g. ":1883"
	TLSAddr string // MQTT over TLS, e.g. ":8883"; needs TLS
	TLS     *tls.Config
}

type Broker struct{ s *mqtt.Server }

// Start begins serving; it returns once the listeners are bound.
func Start(cfg Config, auth *mqttauth.Handler) (*Broker, error) {
	caps := mqtt.NewDefaultServerCapabilities()
	caps.MaximumPacketSize = 256 << 10
	caps.MaximumClientWritesPending = 1024
	caps.MaximumSessionExpiryInterval = 24 * 60 * 60

	s := mqtt.New(&mqtt.Options{
		InlineClient: false,
		Capabilities: caps,
		Logger:       slog.Default().With("component", "mqtt"),
	})
	if err := s.AddHook(&authHook{auth: auth}, nil); err != nil {
		return nil, err
	}
	if cfg.Addr != "" {
		if err := s.AddListener(listeners.NewTCP(listeners.Config{ID: "tcp", Address: cfg.Addr})); err != nil {
			return nil, err
		}
	}
	if cfg.TLSAddr != "" && cfg.TLS != nil {
		if err := s.AddListener(listeners.NewTCP(listeners.Config{ID: "tls", Address: cfg.TLSAddr, TLSConfig: cfg.TLS})); err != nil {
			return nil, err
		}
	}
	if err := s.Serve(); err != nil {
		return nil, err
	}
	slog.Info("embedded mqtt broker listening", "addr", cfg.Addr, "tls_addr", cfg.TLSAddr)
	return &Broker{s: s}, nil
}

func (b *Broker) Close() { _ = b.s.Close() }

type authHook struct {
	mqtt.HookBase
	auth *mqttauth.Handler
}

func (h *authHook) ID() string { return "hooshban-auth" }

func (h *authHook) Provides(b byte) bool {
	return bytes.Contains([]byte{mqtt.OnConnectAuthenticate, mqtt.OnACLCheck}, []byte{b})
}

func (h *authHook) OnConnectAuthenticate(cl *mqtt.Client, pk packets.Packet) bool {
	allow, _ := h.auth.Authenticate(context.Background(), string(pk.Connect.Username), string(pk.Connect.Password), cl.ID)
	return allow
}

func (h *authHook) OnACLCheck(cl *mqtt.Client, topic string, _ bool) bool {
	user := string(cl.Properties.Username)
	// The username was authenticated at connect, so the core account is trusted here.
	if user == h.auth.CoreUser() {
		return true
	}
	return h.auth.Authorize(user, topic)
}
