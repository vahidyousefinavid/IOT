package device

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TelemetryRow struct {
	Time     time.Time
	DeviceID uuid.UUID
	Key      string
	Value    float64
}

// TelemetryWriter batches samples and writes them with COPY, which is far
// cheaper than one INSERT per MQTT message at high device counts.
type TelemetryWriter struct {
	db *pgxpool.Pool
	ch chan TelemetryRow
}

func NewTelemetryWriter(db *pgxpool.Pool) *TelemetryWriter {
	return &TelemetryWriter{db: db, ch: make(chan TelemetryRow, 50_000)}
}

// Add never blocks ingestion; under sustained overload samples are dropped.
func (w *TelemetryWriter) Add(r TelemetryRow) {
	select {
	case w.ch <- r:
	default:
		slog.Warn("telemetry buffer full, dropping sample")
	}
}

func (w *TelemetryWriter) Run(ctx context.Context) {
	const maxBatch = 2000
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	batch := make([]TelemetryRow, 0, maxBatch)

	flush := func() {
		if len(batch) == 0 {
			return
		}
		fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := w.db.CopyFrom(fctx, pgx.Identifier{"telemetry"}, []string{"time", "device_id", "key", "value"},
			pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
				r := batch[i]
				return []any{r.Time, r.DeviceID, r.Key, r.Value}, nil
			}))
		if err != nil {
			slog.Error("telemetry flush failed", "err", err, "rows", len(batch))
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case r := <-w.ch:
			batch = append(batch, r)
			if len(batch) >= maxBatch {
				flush()
			}
		case <-tick.C:
			flush()
		}
	}
}
