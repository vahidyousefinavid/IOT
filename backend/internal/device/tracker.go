package device

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/protocol"
	"hooshban/backend/internal/tracker"
)

// TrackerSender delivers commands to connected trackers (the TCP gateway).
type TrackerSender interface {
	Send(protocol, imei string, a tracker.Action) error
}

// maxImmobilizeSpeed guards against cutting the engine of a moving vehicle.
const maxImmobilizeSpeed = 10 // km/h

var (
	errTrackerOffline = httpx.NewError(http.StatusConflict, "device_offline", "tracker is not connected")
	errVehicleMoving  = httpx.NewError(http.StatusConflict, "vehicle_moving", "vehicle is moving; engine cut refused for safety")
)

// SetTrackers attaches the gateway after construction (they depend on each other).
func (s *Service) SetTrackers(t TrackerSender) { s.trackers = t }

type trackerRoute struct {
	id, siteID uuid.UUID
	expires    time.Time
}

func (s *Service) trackerRoute(ctx context.Context, proto, imei string) (trackerRoute, error) {
	key := proto + ":" + imei
	s.trackerMu.Lock()
	r, ok := s.trackerCache[key]
	s.trackerMu.Unlock()
	if ok && time.Now().Before(r.expires) {
		return r, nil
	}
	err := s.db.QueryRow(ctx,
		`SELECT id, site_id FROM devices WHERE protocol = $1 AND external_id = $2 AND parent_id IS NULL`,
		proto, imei).Scan(&r.id, &r.siteID)
	if err != nil {
		return r, err
	}
	r.expires = time.Now().Add(time.Minute)
	s.trackerMu.Lock()
	if len(s.trackerCache) > 200_000 {
		s.trackerCache = map[string]trackerRoute{}
	}
	s.trackerCache[key] = r
	s.trackerMu.Unlock()
	return r, nil
}

// Known implements tracker.Sink.
func (s *Service) Known(ctx context.Context, proto, imei string) bool {
	_, err := s.trackerRoute(ctx, proto, imei)
	return err == nil
}

// Online implements tracker.Sink.
func (s *Service) Online(ctx context.Context, proto, imei string, online bool) {
	r, err := s.trackerRoute(ctx, proto, imei)
	if err != nil {
		return
	}
	if err := s.apply(ctx, r.siteID, r.id, protocol.Update{State: map[string]any{}, Online: &online}); err != nil {
		slog.Error("tracker online", "err", err)
	}
}

// Report implements tracker.Sink.
func (s *Service) Report(ctx context.Context, proto, imei string, rep tracker.Report) error {
	r, err := s.trackerRoute(ctx, proto, imei)
	if err != nil {
		return err
	}
	state := map[string]any{}
	if rep.HasPosition {
		state["gps_valid"] = rep.Valid
		if rep.Valid {
			state["lat"] = rep.Lat
			state["lon"] = rep.Lon
			state["speed"] = round1(rep.Speed)
			state["course"] = float64(rep.Course)
			state["satellites"] = float64(rep.Satellites)
			state["fix_time"] = rep.Time.Format(time.RFC3339)
			s.positions.Add(PositionRow{
				Time: rep.Time, DeviceID: r.id, Lat: rep.Lat, Lon: rep.Lon,
				Speed: rep.Speed, Course: rep.Course, Satellites: rep.Satellites, Ignition: rep.Ignition,
			})
		}
	}
	setBool := func(k string, v *bool) {
		if v != nil {
			state[k] = *v
		}
	}
	setBool("ignition", rep.Ignition)
	setBool("charging", rep.Charging)
	setBool("power_cut", rep.PowerCut)
	if rep.Battery != nil {
		state["battery"] = float64(*rep.Battery)
	}
	if rep.GSM != nil {
		state["gsm"] = float64(*rep.GSM)
	}
	if rep.Alarm != "" {
		state["alarm"] = rep.Alarm
		state["alarm_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	if rep.CommandAck != "" {
		state["command_ack"] = rep.CommandAck
	}
	online := true
	return s.apply(ctx, r.siteID, r.id, protocol.Update{State: state, Online: &online})
}

// trackerCommand translates the canonical {"immobilized": bool} command.
func (s *Service) trackerCommand(d *Device, cmd map[string]any) error {
	v, ok := cmd["immobilized"].(bool)
	if !ok || len(cmd) != 1 {
		return httpx.BadRequest("unsupported_command", "trackers accept only {\"immobilized\": bool}")
	}
	if d.ExternalID == nil || s.trackers == nil {
		return errTrackerOffline
	}
	if v {
		speed, _ := d.State["speed"].(float64)
		if speed > maxImmobilizeSpeed {
			return errVehicleMoving
		}
	}
	action := tracker.ActionMobilize
	if v {
		action = tracker.ActionImmobilize
	}
	err := s.trackers.Send(d.Protocol, *d.ExternalID, action)
	switch {
	case errors.Is(err, tracker.ErrNotConnected):
		return errTrackerOffline
	case errors.Is(err, tracker.ErrUnsupported):
		return httpx.BadRequest("unsupported_command", "this tracker model does not support remote engine cut")
	}
	return err
}

type TrackPoint struct {
	Time  time.Time `json:"t"`
	Lat   float64   `json:"lat"`
	Lon   float64   `json:"lon"`
	Speed float32   `json:"speed"`
}

// Track returns the route over the period, thinned to at most ~2000 points.
func (s *Service) Track(ctx context.Context, siteID, id uuid.UUID, since time.Duration) ([]TrackPoint, error) {
	if _, err := s.Get(ctx, siteID, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx,
		`WITH p AS (
		   SELECT time, lat, lon, speed, row_number() OVER (ORDER BY time) AS rn, count(*) OVER () AS c
		   FROM positions WHERE device_id = $1 AND time > now() - $2::interval AND valid)
		 SELECT time, lat, lon, speed FROM p
		 WHERE rn % GREATEST(1, c / 2000) = 0 OR rn = c
		 ORDER BY time`, id, since.String())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[TrackPoint])
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

type PositionRow struct {
	Time       time.Time
	DeviceID   uuid.UUID
	Lat, Lon   float64
	Speed      float64
	Course     int
	Satellites int
	Ignition   *bool
}

// PositionWriter batches GPS fixes into COPY statements, like TelemetryWriter.
type PositionWriter struct {
	db *pgxpool.Pool
	ch chan PositionRow
}

func NewPositionWriter(db *pgxpool.Pool) *PositionWriter {
	return &PositionWriter{db: db, ch: make(chan PositionRow, 50_000)}
}

func (w *PositionWriter) Add(r PositionRow) {
	select {
	case w.ch <- r:
	default:
		slog.Warn("position buffer full, dropping fix")
	}
}

func (w *PositionWriter) Run(ctx context.Context) {
	const maxBatch = 2000
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	batch := make([]PositionRow, 0, maxBatch)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := w.db.CopyFrom(fctx, pgx.Identifier{"positions"},
			[]string{"time", "device_id", "lat", "lon", "speed", "course", "satellites", "valid", "ignition"},
			pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
				r := batch[i]
				return []any{r.Time, r.DeviceID, r.Lat, r.Lon, float32(r.Speed), int16(r.Course), int16(r.Satellites), true, r.Ignition}, nil
			}))
		if err != nil {
			slog.Error("position flush failed", "err", err, "rows", len(batch))
		}
		batch = batch[:0]
	}
	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case r := <-w.ch:
			if batch = append(batch, r); len(batch) >= maxBatch {
				flush()
			}
		case <-tick.C:
			flush()
		}
	}
}
