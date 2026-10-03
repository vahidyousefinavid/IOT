package device

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hooshban/backend/internal/events"
	"hooshban/backend/internal/protocol"
)

// route is what ingestion needs to know about a topic owner.
type route struct {
	siteID   uuid.UUID
	protocol string
	expires  time.Time
}

// routeCache avoids a database round-trip per MQTT message.
type routeCache struct {
	mu  sync.RWMutex
	m   map[uuid.UUID]route
	ttl time.Duration
}

func newRouteCache(ttl time.Duration) *routeCache {
	return &routeCache{m: map[uuid.UUID]route{}, ttl: ttl}
}

func (c *routeCache) get(id uuid.UUID) (route, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	r, ok := c.m[id]
	return r, ok && time.Now().Before(r.expires)
}

func (c *routeCache) put(id uuid.UUID, r route) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) > 200_000 {
		c.m = map[uuid.UUID]route{}
	}
	r.expires = time.Now().Add(c.ttl)
	c.m[id] = r
}

func (c *routeCache) forget(id uuid.UUID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.m, id)
}

const maxPayload = 64 << 10

// Ingest handles one MQTT message from the shared subscription.
func (s *Service) Ingest(topic string, payload []byte) {
	if len(payload) > maxPayload {
		return
	}
	siteStr, devStr, rel, ok := protocol.SplitTopic(topic)
	if !ok || rel == "cmd" {
		return
	}
	siteID, err1 := uuid.Parse(siteStr)
	devID, err2 := uuid.Parse(devStr)
	if err1 != nil || err2 != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	r, err := s.route(ctx, devID)
	if err != nil {
		return
	}
	// The broker ACL already confines devices to their root; this is defence in depth.
	if r.siteID != siteID {
		slog.Warn("topic/site mismatch", "topic", topic)
		return
	}
	adapter, ok := protocol.Get(r.protocol)
	if !ok {
		return
	}
	updates, err := adapter.Parse(rel, payload)
	if err != nil {
		slog.Debug("unparseable device message", "topic", topic, "err", err)
		return
	}
	for _, u := range updates {
		if err := s.apply(ctx, siteID, devID, u); err != nil {
			slog.Error("apply update", "err", err, "device", devID)
		}
	}
}

func (s *Service) route(ctx context.Context, id uuid.UUID) (route, error) {
	if r, ok := s.cache.get(id); ok {
		return r, nil
	}
	var r route
	err := s.db.QueryRow(ctx, `SELECT site_id, protocol FROM devices WHERE id = $1 AND parent_id IS NULL`, id).Scan(&r.siteID, &r.protocol)
	if err != nil {
		return r, err
	}
	s.cache.put(id, r)
	return r, nil
}

func (s *Service) apply(ctx context.Context, siteID, devID uuid.UUID, u protocol.Update) error {
	target := devID
	if u.ExternalID != "" {
		child, err := s.child(ctx, siteID, devID, u)
		if err != nil || child == uuid.Nil {
			return err
		}
		target = child
	}

	state := u.State
	if state == nil {
		state = map[string]any{}
	}
	var (
		merged map[string]any
		online bool
		seen   time.Time
	)
	err := s.db.QueryRow(ctx,
		`UPDATE devices SET state = state || $2, online = COALESCE($3, online), last_seen = now()
		 WHERE id = $1 RETURNING state, online, last_seen`,
		target, state, u.Online).Scan(&merged, &online, &seen)
	if err != nil {
		return err
	}

	now := time.Now()
	for k, v := range state {
		if f, ok := v.(float64); ok && protocol.TelemetryKeys[k] {
			s.telemetry.Add(TelemetryRow{Time: now, DeviceID: target, Key: k, Value: f})
		}
	}
	s.events.Publish(ctx, events.Event{
		Type: "device.state", SiteID: siteID, DeviceID: target,
		Data: map[string]any{"state": merged, "online": online, "last_seen": seen},
	})
	return nil
}

// child resolves (and on first sight, registers) a device behind a bridge.
func (s *Service) child(ctx context.Context, siteID, bridgeID uuid.UUID, u protocol.Update) (uuid.UUID, error) {
	if len(u.ExternalID) > 128 {
		return uuid.Nil, nil
	}
	var id uuid.UUID
	err := s.db.QueryRow(ctx, `SELECT id FROM devices WHERE parent_id = $1 AND external_id = $2`, bridgeID, u.ExternalID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	if u.State == nil {
		return uuid.Nil, nil // availability for an unknown device: wait for its first state
	}
	err = s.db.QueryRow(ctx,
		`INSERT INTO devices (site_id, parent_id, name, kind, protocol, external_id)
		 SELECT $1, $2, $3, $4, protocol, $3 FROM devices WHERE id = $2
		 ON CONFLICT (parent_id, external_id) DO UPDATE SET external_id = EXCLUDED.external_id
		 RETURNING id`,
		siteID, bridgeID, u.ExternalID, guessKind(u.State)).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	s.events.Publish(ctx, events.Event{Type: "device.created", SiteID: siteID, DeviceID: id})
	return id, nil
}

func guessKind(state map[string]any) string {
	has := func(k string) bool { _, ok := state[k]; return ok }
	switch {
	case has("target_temperature"):
		return "thermostat"
	case has("locked"):
		return "lock"
	case has("position"):
		return "curtain"
	case has("brightness") || has("color_temp"):
		return "light"
	case has("power") || has("energy"):
		return "plug"
	case has("on"):
		return "switch"
	case has("temperature") || has("humidity") || has("contact") || has("occupancy"):
		return "sensor"
	}
	return "other"
}
