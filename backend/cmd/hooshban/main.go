// Command hooshban runs the Hooshban API: REST + WebSocket for the app,
// MQTT ingestion for devices, and EMQX auth callbacks on an internal port.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"hooshban/backend/internal/audit"
	"hooshban/backend/internal/auth"
	"hooshban/backend/internal/broker"
	"hooshban/backend/internal/config"
	"hooshban/backend/internal/db"
	"hooshban/backend/internal/device"
	"hooshban/backend/internal/embedbroker"
	"hooshban/backend/internal/events"
	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/mqttauth"
	"hooshban/backend/internal/ratelimit"
	"hooshban/backend/internal/realtime"
	"hooshban/backend/internal/security"
	"hooshban/backend/internal/site"
	"hooshban/backend/internal/tracker"
)

// Set at build time: -ldflags "-X main.version=1.2.3 -X main.commit=abc123".
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("version", version))
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cfg.JWTSeed == nil {
		slog.Warn("JWT_ED25519_SEED not set: using an ephemeral signing key (development only)")
	}
	if cfg.DevicePepper == nil {
		slog.Warn("DEVICE_PEPPER not set: using an insecure development pepper")
		cfg.DevicePepper = []byte("development-pepper-do-not-use!!!")
	}

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	ropts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return err
	}
	rdb := redis.NewClient(ropts)
	defer rdb.Close()

	signer, err := security.NewSigner(cfg.JWTSeed, cfg.Issuer, cfg.AccessTTL)
	if err != nil {
		return err
	}

	var (
		bus       = events.NewBus(rdb)
		limiter   = ratelimit.New(rdb)
		auditLog  = audit.New(pool)
		telemetry = device.NewTelemetryWriter(pool)
		positions = device.NewPositionWriter(pool)
		sites     = site.NewService(pool)
		pub       = &lazyPublisher{}
		devices   = device.NewService(pool, cfg.DevicePepper, pub, bus, telemetry, positions)
		hub       = realtime.NewHub(signer, sites, originHosts(cfg.CORSOrigins))
		authSvc   = auth.NewService(pool, signer, cfg.RefreshTTL)
		authH     = auth.NewHandler(authSvc, signer, limiter, auditLog, cfg.TrustProxy)
	)

	go telemetry.Run(ctx)
	go positions.Run(ctx)

	// Cellular GPS trackers connect over raw TCP, one port per protocol.
	gateway := tracker.NewGateway(devices)
	devices.SetTrackers(gateway)
	for proto, addr := range cfg.TrackerAddrs {
		if addr == "" {
			continue
		}
		go func() {
			if err := gateway.Listen(ctx, proto, addr); err != nil {
				slog.Error("tracker gateway failed", "protocol", proto, "err", err)
			}
		}()
	}
	go bus.Subscribe(ctx, hub.Broadcast)

	// Internal listener first: EMQX must be able to authenticate us before we connect.
	internal := http.NewServeMux()
	mqttAuth := mqttauth.New(pool, cfg.DevicePepper, cfg.InternalToken, cfg.MQTTCoreUser, cfg.MQTTCorePassword)
	mqttAuth.Routes(internal)

	if cfg.EmbeddedMQTTAddr != "" {
		eb, err := embedbroker.Start(embedbroker.Config{Addr: cfg.EmbeddedMQTTAddr}, mqttAuth)
		if err != nil {
			return err
		}
		defer eb.Close()
	}
	internalSrv := newServer(cfg.InternalAddr, internal)
	go serve(internalSrv, "internal")

	go func() {
		c, err := broker.Connect(ctx, cfg.MQTTURL, cfg.MQTTCoreUser, cfg.MQTTCorePassword, devices.Ingest)
		if err != nil {
			slog.Error("mqtt unavailable", "err", err)
			return
		}
		pub.set(c)
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("GET /version", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"version": version, "commit": commit})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if pool.Ping(r.Context()) != nil || rdb.Ping(r.Context()).Err() != nil || !pub.connected() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	authH.Routes(mux)
	site.NewHandler(sites, authH.Require, limiter, auditLog, cfg.TrustProxy).Routes(mux)
	device.NewHandler(devices, sites, auditLog, authH.Require, cfg.TrustProxy).Routes(mux)
	mux.Handle("GET /v1/ws", hub)

	api := httpx.Chain(mux,
		httpx.Recover,
		httpx.WithRequestID,
		httpx.Logger,
		httpx.SecureHeaders(cfg.IsProd()),
		httpx.CORS(cfg.CORSOrigins),
		httpx.MaxBody(1<<20),
	)
	apiSrv := newServer(cfg.HTTPAddr, api)
	go serve(apiSrv, "api")

	<-ctx.Done()
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = apiSrv.Shutdown(shutdownCtx)
	_ = internalSrv.Shutdown(shutdownCtx)
	pub.close()
	return nil
}

// originHosts turns "https://app.example.com" into the host pattern the
// WebSocket origin check expects.
func originHosts(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			out = append(out, u.Host)
		}
	}
	return out
}

func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// No WriteTimeout: it would cut long-lived WebSocket connections.
	}
}

func serve(s *http.Server, name string) {
	slog.Info("listening", "server", name, "addr", s.Addr)
	if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "server", name, "err", err)
		os.Exit(1)
	}
}
