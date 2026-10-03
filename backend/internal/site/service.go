// Package site manages sites (homes, buildings, machines), their members and rooms.
package site

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hooshban/backend/internal/httpx"
)

type Role string

const (
	RoleGuest  Role = "guest"
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
	RoleOwner  Role = "owner"
)

var rank = map[Role]int{RoleGuest: 1, RoleMember: 2, RoleAdmin: 3, RoleOwner: 4}

func (r Role) AtLeast(min Role) bool { return rank[r] >= rank[min] }

type Site struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Timezone  string    `json:"timezone"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type Room struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Icon string    `json:"icon"`
	Sort int       `json:"sort"`
}

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Authorize returns the caller's role in the site. Non-members get 404, not
// 403, so site IDs cannot be probed.
func (s *Service) Authorize(ctx context.Context, siteID, userID uuid.UUID, min Role) (Role, error) {
	var role Role
	err := s.db.QueryRow(ctx, `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`, siteID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", httpx.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !role.AtLeast(min) {
		return role, httpx.ErrForbidden
	}
	return role, nil
}

func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Site, error) {
	rows, err := s.db.Query(ctx,
		`SELECT s.id, s.name, s.kind, s.timezone, m.role, s.created_at
		 FROM sites s JOIN site_members m ON m.site_id = s.id
		 WHERE m.user_id = $1 ORDER BY s.created_at`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Site, error) {
		var x Site
		err := r.Scan(&x.ID, &x.Name, &x.Kind, &x.Timezone, &x.Role, &x.CreatedAt)
		return x, err
	})
}

var defaultRooms = map[string][]Room{
	"home":     {{Name: "پذیرایی", Icon: "sofa"}, {Name: "آشپزخانه", Icon: "chef-hat"}, {Name: "اتاق خواب", Icon: "bed"}},
	"building": {{Name: "لابی", Icon: "door-open"}, {Name: "پارکینگ", Icon: "car"}},
	"machine":  {{Name: "خط تولید", Icon: "factory"}},
}

func (s *Service) Create(ctx context.Context, userID uuid.UUID, name, kind string) (*Site, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 60 {
		return nil, httpx.BadRequest("invalid_name", "name must be 1-60 characters")
	}
	if _, ok := defaultRooms[kind]; !ok {
		return nil, httpx.BadRequest("invalid_kind", "kind must be home, building or machine")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	x := Site{Name: name, Kind: kind, Role: RoleOwner}
	if err := tx.QueryRow(ctx,
		`INSERT INTO sites (name, kind) VALUES ($1, $2) RETURNING id, timezone, created_at`,
		name, kind).Scan(&x.ID, &x.Timezone, &x.CreatedAt); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO site_members (site_id, user_id, role) VALUES ($1, $2, 'owner')`, x.ID, userID); err != nil {
		return nil, err
	}
	for i, r := range defaultRooms[kind] {
		if _, err := tx.Exec(ctx, `INSERT INTO rooms (site_id, name, icon, sort) VALUES ($1, $2, $3, $4)`, x.ID, r.Name, r.Icon, i); err != nil {
			return nil, err
		}
	}
	return &x, tx.Commit(ctx)
}

func (s *Service) Rooms(ctx context.Context, siteID uuid.UUID) ([]Room, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, icon, sort FROM rooms WHERE site_id = $1 ORDER BY sort, created_at`, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Room])
}

func (s *Service) CreateRoom(ctx context.Context, siteID uuid.UUID, name, icon string) (*Room, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return nil, httpx.BadRequest("invalid_name", "name must be 1-40 characters")
	}
	if icon == "" {
		icon = "sofa"
	}
	if len(icon) > 32 {
		return nil, httpx.BadRequest("invalid_icon", "icon too long")
	}
	r := Room{Name: name, Icon: icon}
	err := s.db.QueryRow(ctx,
		`INSERT INTO rooms (site_id, name, icon, sort)
		 VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), -1) + 1 FROM rooms WHERE site_id = $1))
		 RETURNING id, sort`, siteID, name, icon).Scan(&r.ID, &r.Sort)
	return &r, err
}
