// Package config loads runtime configuration from environment variables.
// Secrets are never given defaults in production: the service refuses to start instead.
package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env string // "development" | "production"

	HTTPAddr     string // public API listener
	InternalAddr string // broker callbacks (authn/authz); never expose publicly
	CORSOrigins  []string
	// TrustProxy honours X-Forwarded-For; enable only behind a proxy that overwrites it.
	TrustProxy bool

	DatabaseURL string
	RedisURL    string

	// TrackerAddrs maps a GPS tracker protocol to its TCP listen address;
	// an empty address disables that protocol.
	TrackerAddrs map[string]string

	// EmbeddedMQTTAddr, when set, runs an MQTT broker inside this process
	// (small installs) instead of relying on an external EMQX.
	EmbeddedMQTTAddr string

	MQTTURL          string
	MQTTCoreUser     string
	MQTTCorePassword string

	// InternalToken authenticates EMQX -> backend HTTP callbacks.
	InternalToken string
	// DevicePepper is an HMAC key mixed into stored device secrets, so a
	// database leak alone does not allow forging device logins.
	DevicePepper []byte
	// JWTSeed is a 32-byte Ed25519 seed used to sign access tokens.
	JWTSeed []byte

	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Issuer     string
}

func (c *Config) IsProd() bool { return c.Env == "production" }

func Load() (*Config, error) {
	c := &Config{
		Env:              env("APP_ENV", "development"),
		HTTPAddr:         env("HTTP_ADDR", ":8080"),
		InternalAddr:     env("INTERNAL_ADDR", ":9090"),
		CORSOrigins:      split(env("CORS_ORIGINS", "")),
		TrustProxy:       env("TRUST_PROXY", "false") == "true",
		DatabaseURL:      env("DATABASE_URL", "postgres://hooshban:hooshban@localhost:5432/hooshban?sslmode=disable"),
		RedisURL:         env("REDIS_URL", "redis://localhost:6379/0"),
		MQTTURL:          env("MQTT_URL", "tcp://localhost:1883"),
		EmbeddedMQTTAddr: os.Getenv("MQTT_EMBEDDED_ADDR"),
		TrackerAddrs: map[string]string{
			"gt06": os.Getenv("TRACKER_GT06_ADDR"),
			"h02":  os.Getenv("TRACKER_H02_ADDR"),
		},
		MQTTCoreUser:     env("MQTT_CORE_USER", "hooshban-core"),
		MQTTCorePassword: os.Getenv("MQTT_CORE_PASSWORD"),
		InternalToken:    os.Getenv("INTERNAL_TOKEN"),
		AccessTTL:        dur("ACCESS_TTL", 10*time.Minute),
		RefreshTTL:       dur("REFRESH_TTL", 30*24*time.Hour),
		Issuer:           env("JWT_ISSUER", "hooshban"),
	}

	var err error
	if c.JWTSeed, err = b64("JWT_ED25519_SEED", 32); err != nil {
		return nil, err
	}
	if c.DevicePepper, err = b64("DEVICE_PEPPER", 32); err != nil {
		return nil, err
	}

	if c.IsProd() {
		missing := []string{}
		if c.JWTSeed == nil {
			missing = append(missing, "JWT_ED25519_SEED")
		}
		if c.DevicePepper == nil {
			missing = append(missing, "DEVICE_PEPPER")
		}
		if len(c.InternalToken) < 32 {
			missing = append(missing, "INTERNAL_TOKEN (>=32 chars)")
		}
		if len(c.MQTTCorePassword) < 24 {
			missing = append(missing, "MQTT_CORE_PASSWORD (>=24 chars)")
		}
		if len(missing) > 0 {
			return nil, fmt.Errorf("production config missing secrets: %s", strings.Join(missing, ", "))
		}
	}
	return c, nil
}

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func dur(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return def
}

func split(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// b64 decodes a base64 secret of an exact length; an unset variable returns nil.
func b64(k string, n int) ([]byte, error) {
	v := os.Getenv(k)
	if v == "" {
		return nil, nil
	}
	b, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		return nil, fmt.Errorf("%s: invalid base64: %w", k, err)
	}
	if len(b) != n {
		return nil, fmt.Errorf("%s: want %d bytes, got %d", k, n, len(b))
	}
	return b, nil
}
