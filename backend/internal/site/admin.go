package site

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/security"
)

const inviteTTL = 7 * 24 * time.Hour

var (
	errLastOwner     = httpx.NewError(http.StatusConflict, "last_owner", "a site must keep at least one owner")
	errInvalidInvite = httpx.NewError(http.StatusNotFound, "invalid_invite", "invite code is invalid or expired")
	errAlreadyMember = httpx.NewError(http.StatusConflict, "already_member", "you are already a member of this site")
)

func validRole(r Role) bool { _, ok := rank[r]; return ok }

// canManage reports whether actor may assign or change target roles: only
// owners touch owners; admins manage admin and below.
func canManage(actor, target Role) bool {
	if actor == RoleOwner {
		return true
	}
	return actor == RoleAdmin && target != RoleOwner
}

func (s *Service) Update(ctx context.Context, siteID uuid.UUID, name *string, timezone *string) (*Site, error) {
	if name != nil {
		n := strings.TrimSpace(*name)
		if c := utf8.RuneCountInString(n); c < 1 || c > 60 {
			return nil, httpx.BadRequest("invalid_name", "name must be 1-60 characters")
		}
		name = &n
	}
	if timezone != nil {
		if _, err := time.LoadLocation(*timezone); err != nil || *timezone == "" {
			return nil, httpx.BadRequest("invalid_timezone", "unknown timezone")
		}
	}
	var x Site
	err := s.db.QueryRow(ctx,
		`UPDATE sites SET name = COALESCE($2, name), timezone = COALESCE($3, timezone) WHERE id = $1
		 RETURNING id, name, kind, timezone, created_at`, siteID, name, timezone).
		Scan(&x.ID, &x.Name, &x.Kind, &x.Timezone, &x.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	return &x, err
}

func (s *Service) Delete(ctx context.Context, siteID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sites WHERE id = $1`, siteID)
	return err
}

func (s *Service) UpdateRoom(ctx context.Context, siteID, roomID uuid.UUID, name, icon *string) (*Room, error) {
	if name != nil {
		n := strings.TrimSpace(*name)
		if c := utf8.RuneCountInString(n); c < 1 || c > 40 {
			return nil, httpx.BadRequest("invalid_name", "name must be 1-40 characters")
		}
		name = &n
	}
	if icon != nil && (len(*icon) == 0 || len(*icon) > 32) {
		return nil, httpx.BadRequest("invalid_icon", "invalid icon")
	}
	var r Room
	err := s.db.QueryRow(ctx,
		`UPDATE rooms SET name = COALESCE($3, name), icon = COALESCE($4, icon) WHERE id = $1 AND site_id = $2
		 RETURNING id, name, icon, sort`, roomID, siteID, name, icon).Scan(&r.ID, &r.Name, &r.Icon, &r.Sort)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrNotFound
	}
	return &r, err
}

// DeleteRoom keeps the room's devices; they simply become unassigned.
func (s *Service) DeleteRoom(ctx context.Context, siteID, roomID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM rooms WHERE id = $1 AND site_id = $2`, roomID, siteID)
	if err == nil && tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	return err
}

type Member struct {
	UserID   uuid.UUID `json:"user_id"`
	Email    string    `json:"email"`
	FullName string    `json:"full_name"`
	Role     Role      `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

func (s *Service) Members(ctx context.Context, siteID uuid.UUID) ([]Member, error) {
	rows, err := s.db.Query(ctx,
		`SELECT u.id, u.email, u.full_name, m.role, m.created_at
		 FROM site_members m JOIN users u ON u.id = m.user_id
		 WHERE m.site_id = $1
		 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, m.created_at`, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Member])
}

// SetRole changes a member's role. The whole check runs in one transaction
// with the site's member rows locked, so two concurrent demotions cannot
// leave a site without an owner.
func (s *Service) SetRole(ctx context.Context, siteID uuid.UUID, actor Role, target uuid.UUID, role Role) error {
	if !validRole(role) {
		return httpx.BadRequest("invalid_role", "unknown role")
	}
	return s.changeMember(ctx, siteID, target, func(tx pgx.Tx, current Role) error {
		if !canManage(actor, current) || !canManage(actor, role) {
			return httpx.ErrForbidden
		}
		_, err := tx.Exec(ctx, `UPDATE site_members SET role = $3 WHERE site_id = $1 AND user_id = $2`, siteID, target, role)
		return err
	}, role != RoleOwner)
}

// RemoveMember removes target. Anyone may remove themselves (leave).
func (s *Service) RemoveMember(ctx context.Context, siteID uuid.UUID, actorID uuid.UUID, actor Role, target uuid.UUID) error {
	return s.changeMember(ctx, siteID, target, func(tx pgx.Tx, current Role) error {
		if actorID != target && !canManage(actor, current) {
			return httpx.ErrForbidden
		}
		_, err := tx.Exec(ctx, `DELETE FROM site_members WHERE site_id = $1 AND user_id = $2`, siteID, target)
		return err
	}, true)
}

func (s *Service) changeMember(ctx context.Context, siteID uuid.UUID, target uuid.UUID, apply func(pgx.Tx, Role) error, losesOwner bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `SELECT user_id, role FROM site_members WHERE site_id = $1 FOR UPDATE`, siteID)
	if err != nil {
		return err
	}
	var (
		current Role
		found   bool
		owners  int
	)
	for rows.Next() {
		var id uuid.UUID
		var r Role
		if err := rows.Scan(&id, &r); err != nil {
			rows.Close()
			return err
		}
		if r == RoleOwner {
			owners++
		}
		if id == target {
			current, found = r, true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return httpx.ErrNotFound
	}
	if current == RoleOwner && losesOwner && owners <= 1 {
		return errLastOwner
	}
	if err := apply(tx, current); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type Invite struct {
	ID        uuid.UUID `json:"id"`
	Role      Role      `json:"role"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	// Code is only present in the creation response.
	Code string `json:"code,omitempty"`
}

// Unambiguous alphabet: no 0/O, 1/I/L.
const inviteAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func newInviteCode() (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 0, 11)
	for i, v := range b {
		if i == 5 {
			out = append(out, '-')
		}
		// 256 % 31 bias is negligible for a short-lived, rate-limited, single-use code.
		out = append(out, inviteAlphabet[int(v)%len(inviteAlphabet)])
	}
	return string(out), nil
}

func normalizeCode(c string) string {
	c = strings.ToUpper(strings.TrimSpace(c))
	c = strings.NewReplacer(" ", "", "-", "").Replace(c)
	if len(c) == 10 {
		c = c[:5] + "-" + c[5:]
	}
	return c
}

func (s *Service) CreateInvite(ctx context.Context, siteID, createdBy uuid.UUID, actor, role Role) (*Invite, error) {
	if !validRole(role) {
		return nil, httpx.BadRequest("invalid_role", "unknown role")
	}
	if !canManage(actor, role) {
		return nil, httpx.ErrForbidden
	}
	code, err := newInviteCode()
	if err != nil {
		return nil, err
	}
	inv := Invite{Role: role, Code: code}
	err = s.db.QueryRow(ctx,
		`INSERT INTO site_invites (site_id, code_hash, role, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, now() + $5::interval) RETURNING id, expires_at, created_at`,
		siteID, security.SHA256(code), role, createdBy, inviteTTL.String()).Scan(&inv.ID, &inv.ExpiresAt, &inv.CreatedAt)
	return &inv, err
}

func (s *Service) Invites(ctx context.Context, siteID uuid.UUID) ([]Invite, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, role, expires_at, created_at FROM site_invites
		 WHERE site_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
		 ORDER BY created_at DESC`, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Invite, error) {
		var i Invite
		err := r.Scan(&i.ID, &i.Role, &i.ExpiresAt, &i.CreatedAt)
		return i, err
	})
}

func (s *Service) RevokeInvite(ctx context.Context, siteID, inviteID uuid.UUID) error {
	tag, err := s.db.Exec(ctx, `UPDATE site_invites SET revoked_at = now() WHERE id = $1 AND site_id = $2 AND used_at IS NULL`, inviteID, siteID)
	if err == nil && tag.RowsAffected() == 0 {
		return httpx.ErrNotFound
	}
	return err
}

// Redeem joins the user to the invite's site. Codes are single-use.
func (s *Service) Redeem(ctx context.Context, userID uuid.UUID, code string) (*Site, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var (
		inviteID, siteID uuid.UUID
		role             Role
	)
	err = tx.QueryRow(ctx,
		`SELECT id, site_id, role FROM site_invites
		 WHERE code_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
		 FOR UPDATE`, security.SHA256(normalizeCode(code))).Scan(&inviteID, &siteID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errInvalidInvite
	}
	if err != nil {
		return nil, err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO site_members (site_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, siteID, userID, role)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errAlreadyMember
	}
	if _, err := tx.Exec(ctx, `UPDATE site_invites SET used_by = $2, used_at = now() WHERE id = $1`, inviteID, userID); err != nil {
		return nil, err
	}
	x := Site{Role: role}
	if err := tx.QueryRow(ctx, `SELECT id, name, kind, timezone, created_at FROM sites WHERE id = $1`, siteID).
		Scan(&x.ID, &x.Name, &x.Kind, &x.Timezone, &x.CreatedAt); err != nil {
		return nil, err
	}
	return &x, tx.Commit(ctx)
}
