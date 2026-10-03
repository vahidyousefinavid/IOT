// Package device manages devices, their broker credentials, commands and
// the ingestion of state reported over MQTT.
package device

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"hooshban/backend/internal/events"
	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/protocol"
	"hooshban/backend/internal/security"
	"hooshban/backend/internal/tracker"
)

var Kinds = map[string]bool{
	"light": true, "switch": true, "plug": true, "thermostat": true, "ac": true,
	"fan": true, "curtain": true, "lock": true, "sensor": true, "camera": true,
	"meter": true, "bridge": true, "machine": true, "tracker": true, "other": true,
}

type Device struct {
	ID         uuid.UUID      `json:"id"`
	SiteID     uuid.UUID      `json:"site_id"`
	RoomID     *uuid.UUID     `json:"room_id"`
	ParentID   *uuid.UUID     `json:"parent_id"`
	Name       string         `json:"name"`
	Kind       string         `json:"kind"`
	Protocol   string         `json:"protocol"`
	ExternalID *string        `json:"external_id"`
	State      map[string]any `json:"state"`
	Online     bool           `json:"online"`
	LastSeen   *time.Time     `json:"last_seen"`
	CreatedAt  time.Time      `json:"created_at"`
}

const deviceCols = `id, site_id, room_id, parent_id, name, kind, protocol, external_id, state, online, last_seen, created_at`

func scanDevice(r pgx.Row) (Device, error) {
	var d Device
	err := r.Scan(&d.ID, &d.SiteID, &d.RoomID, &d.ParentID, &d.Name, &d.Kind, &d.Protocol,
		&d.ExternalID, &d.State, &d.Online, &d.LastSeen, &d.CreatedAt)
	return d, err
}

// Credentials are shown exactly once, at creation or rotation.
type Credentials struct {
	Username  string `json:"mqtt_username"`
	Password  string `json:"mqtt_password"`
	TopicRoot string `json:"topic_root"`
}

type Publisher interface {
	Publish(topic string, payload []byte) error
}

type Service struct {
	db        *pgxpool.Pool
	pepper    []byte
	mqtt      Publisher
	events    *events.Bus
	telemetry *TelemetryWriter
	positions *PositionWriter
	cache     *routeCache

	trackers     TrackerSender
	trackerMu    sync.Mutex
	trackerCache map[string]trackerRoute
}

func NewService(db *pgxpool.Pool, pepper []byte, mqtt Publisher, bus *events.Bus, tw *TelemetryWriter, pw *PositionWriter) *Service {
	return &Service{
		db: db, pepper: pepper, mqtt: mqtt, events: bus, telemetry: tw, positions: pw,
		cache: newRouteCache(time.Minute), trackerCache: map[string]trackerRoute{},
	}
}

func (s *Service) List(ctx context.Context, siteID uuid.UUID) ([]Device, error) {
	rows, err := s.db.Query(ctx, `SELECT `+deviceCols+` FROM devices WHERE site_id = $1 ORDER BY created_at`, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Device, error) { return scanDevice(r) })
}

func (s *Service) Get(ctx context.Context, siteID, id uuid.UUID) (*Device, error) {
	d, err := scanDevice(s.db.QueryRow(ctx, `SELECT `+deviceCols+` FROM devices WHERE id = $1 AND site_id = $2`, id, siteID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	return &d, err
}

type CreateInput struct {
	Name     string     `json:"name"`
	Kind     string     `json:"kind"`
	Protocol string     `json:"protocol"`
	RoomID   *uuid.UUID `json:"room_id"`
	// ExternalID is the IMEI / device ID of a GPS tracker.
	ExternalID *string `json:"external_id"`
}

var errIMEITaken = httpx.NewError(http.StatusConflict, "imei_taken", "this tracker is already registered")

func (s *Service) Create(ctx context.Context, siteID uuid.UUID, in CreateInput) (*Device, *Credentials, error) {
	in.Name = strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 60 {
		return nil, nil, httpx.BadRequest("invalid_name", "name must be 1-60 characters")
	}
	if !Kinds[in.Kind] {
		return nil, nil, httpx.BadRequest("invalid_kind", "unknown device kind")
	}
	isTracker := tracker.IsTrackerProtocol(in.Protocol)
	if !protocol.Supported(in.Protocol) && !isTracker {
		return nil, nil, httpx.BadRequest("invalid_protocol", "unsupported protocol")
	}
	var externalID *string
	if isTracker {
		if in.ExternalID == nil || !tracker.ValidID(strings.TrimSpace(*in.ExternalID)) {
			return nil, nil, httpx.BadRequest("invalid_imei", "tracker IMEI / ID must be 6-20 digits")
		}
		id := strings.TrimSpace(*in.ExternalID)
		externalID = &id
		in.Kind = "tracker"
	} else if in.Kind == "tracker" {
		return nil, nil, httpx.BadRequest("invalid_protocol", "trackers need a tracker protocol (gt06, h02)")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	if err := checkRoom(ctx, tx, siteID, in.RoomID); err != nil {
		return nil, nil, err
	}
	d, err := scanDevice(tx.QueryRow(ctx,
		`INSERT INTO devices (site_id, room_id, name, kind, protocol, external_id) VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+deviceCols, siteID, in.RoomID, in.Name, in.Kind, in.Protocol, externalID))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return nil, nil, errIMEITaken
	}
	if err != nil {
		return nil, nil, err
	}
	// Trackers authenticate by IMEI on the gateway; they get no MQTT credentials.
	var creds *Credentials
	if !isTracker {
		if creds, err = s.issueCredentials(ctx, tx, &d); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	s.events.Publish(ctx, events.Event{Type: "device.created", SiteID: siteID, DeviceID: d.ID})
	return &d, creds, nil
}

type UpdateInput struct {
	Name   *string    `json:"name"`
	Kind   *string    `json:"kind"`
	RoomID *uuid.UUID `json:"room_id"`
}

func (s *Service) Update(ctx context.Context, siteID, id uuid.UUID, in UpdateInput) (*Device, error) {
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if c := utf8.RuneCountInString(n); c < 1 || c > 60 {
			return nil, httpx.BadRequest("invalid_name", "name must be 1-60 characters")
		}
		in.Name = &n
	}
	if in.Kind != nil && !Kinds[*in.Kind] {
		return nil, httpx.BadRequest("invalid_kind", "unknown device kind")
	}
	if in.Kind != nil {
		cur, err := s.Get(ctx, siteID, id)
		if err != nil {
			return nil, err
		}
		// A tracker stays a tracker: its kind follows from its protocol.
		if tracker.IsTrackerProtocol(cur.Protocol) != (*in.Kind == "tracker") {
			return nil, httpx.BadRequest("invalid_kind", "tracker kind cannot be changed")
		}
	}
	if err := checkRoom(ctx, s.db, siteID, in.RoomID); err != nil {
		return nil, err
	}
	d, err := scanDevice(s.db.QueryRow(ctx,
		`UPDATE devices SET name = COALESCE($3, name), room_id = COALESCE($4, room_id), kind = COALESCE($5, kind)
		 WHERE id = $1 AND site_id = $2 RETURNING `+deviceCols, id, siteID, in.Name, in.RoomID, in.Kind))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	return &d, err
}

func (s *Service) Delete(ctx context.Context, siteID, id uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM devices WHERE id = $1 AND site_id = $2`, id, siteID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	s.cache.forget(id)
	s.events.Publish(ctx, events.Event{Type: "device.deleted", SiteID: siteID, DeviceID: id})
	return nil
}

// RotateCredentials replaces the device's broker password. The old one stops
// working on the device's next connection attempt.
func (s *Service) RotateCredentials(ctx context.Context, siteID, id uuid.UUID) (*Credentials, error) {
	d, err := s.Get(ctx, siteID, id)
	if err != nil {
		return nil, err
	}
	if d.ParentID != nil || tracker.IsTrackerProtocol(d.Protocol) {
		return nil, httpx.BadRequest("no_credentials", "this device has no MQTT credentials")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	creds, err := s.issueCredentials(ctx, tx, d)
	if err != nil {
		return nil, err
	}
	return creds, tx.Commit(ctx)
}

func (s *Service) issueCredentials(ctx context.Context, tx pgx.Tx, d *Device) (*Credentials, error) {
	secret, err := security.RandomToken(32)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO device_credentials (device_id, secret_hash) VALUES ($1, $2)
		 ON CONFLICT (device_id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, created_at = now(), revoked_at = NULL`,
		d.ID, security.Peppered(s.pepper, secret)); err != nil {
		return nil, err
	}
	return &Credentials{
		Username:  MQTTUsername(d.SiteID, d.ID),
		Password:  secret,
		TopicRoot: protocol.Root(d.SiteID.String(), d.ID.String()),
	}, nil
}

// Command validates a canonical command and sends it in the device's own dialect.
func (s *Service) Command(ctx context.Context, siteID, id uuid.UUID, cmd map[string]any) error {
	if err := protocol.ValidateCommand(cmd); err != nil {
		return httpx.BadRequest("invalid_command", err.Error())
	}
	d, err := s.Get(ctx, siteID, id)
	if err != nil {
		return err
	}
	if tracker.IsTrackerProtocol(d.Protocol) {
		return s.trackerCommand(d, cmd)
	}

	// A child device is addressed through its bridge's topic root and adapter.
	rootID, proto, ext := d.ID, d.Protocol, ""
	if d.ParentID != nil {
		rootID = *d.ParentID
		if d.ExternalID != nil {
			ext = *d.ExternalID
		}
	}
	adapter, ok := protocol.Get(proto)
	if !ok {
		return httpx.BadRequest("invalid_protocol", "unsupported protocol")
	}
	msgs, err := adapter.Command(protocol.Root(siteID.String(), rootID.String()), ext, cmd)
	if err != nil {
		return httpx.BadRequest("unsupported_command", err.Error())
	}
	for _, m := range msgs {
		if err := s.mqtt.Publish(m.Topic, m.Payload); err != nil {
			return httpx.NewError(http.StatusBadGateway, "broker_unavailable", "device broker unavailable")
		}
	}
	return nil
}

type Point struct {
	Time  time.Time `json:"t"`
	Value float64   `json:"v"`
}

// History returns bucketed averages of one telemetry key.
func (s *Service) History(ctx context.Context, siteID, id uuid.UUID, key string, since time.Duration, bucket time.Duration) ([]Point, error) {
	if !protocol.TelemetryKeys[key] {
		return nil, httpx.BadRequest("invalid_key", "unknown telemetry key")
	}
	if _, err := s.Get(ctx, siteID, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx,
		`SELECT to_timestamp(floor(extract(epoch FROM time)::float8 / $4::float8) * $4::float8) AS b, avg(value)
		 FROM telemetry WHERE device_id = $1 AND key = $2 AND time > now() - $3::interval
		 GROUP BY b ORDER BY b`,
		id, key, since.String(), bucket.Seconds())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Point])
}

func MQTTUsername(siteID, deviceID uuid.UUID) string {
	return siteID.String() + "." + deviceID.String()
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func checkRoom(ctx context.Context, q querier, siteID uuid.UUID, roomID *uuid.UUID) error {
	if roomID == nil {
		return nil
	}
	var ok bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rooms WHERE id = $1 AND site_id = $2)`, *roomID, siteID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return httpx.BadRequest("invalid_room", "room does not belong to this site")
	}
	return nil
}
