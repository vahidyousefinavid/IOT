// Package audit records security-relevant actions (logins, commands,
// credential changes) in an append-only table.
package audit

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	UserID uuid.UUID
	SiteID uuid.UUID
	Action string
	Target string
	IP     string
	Meta   map[string]any
}

type Log struct{ db *pgxpool.Pool }

func New(db *pgxpool.Pool) *Log { return &Log{db: db} }

// Record never fails the caller; a lost audit row is logged instead.
func (l *Log) Record(ctx context.Context, e Entry) {
	if e.Meta == nil {
		e.Meta = map[string]any{}
	}
	_, err := l.db.Exec(ctx,
		`INSERT INTO audit_log (user_id, site_id, action, target, ip, meta)
		 VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, '')::inet, $6)`,
		nullUUID(e.UserID), nullUUID(e.SiteID), e.Action, e.Target, e.IP, e.Meta)
	if err != nil {
		slog.Error("audit write failed", "err", err, "action", e.Action)
	}
}

func nullUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
