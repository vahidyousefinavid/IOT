// Package auth handles accounts, sessions and access tokens.
//
// Sessions use short-lived access tokens (JWT, EdDSA) plus opaque refresh
// tokens that rotate on every use. Presenting an already-rotated refresh token
// means it was stolen, so the whole token family is revoked.
package auth

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/security"
)

const (
	maxFailedLogins = 10
	lockoutDuration = 15 * time.Minute
	minPasswordLen  = 10
)

var (
	errInvalidCredentials = httpx.NewError(http.StatusUnauthorized, "invalid_credentials", "email or password is wrong")
	errAccountLocked      = httpx.NewError(http.StatusLocked, "account_locked", "too many failed attempts, try later")
	errEmailTaken         = httpx.NewError(http.StatusConflict, "email_taken", "email already registered")
	errInvalidRefresh     = httpx.NewError(http.StatusUnauthorized, "invalid_refresh", "session expired, sign in again")
)

type Service struct {
	db         *pgxpool.Pool
	signer     *security.Signer
	refreshTTL time.Duration
}

func NewService(db *pgxpool.Pool, signer *security.Signer, refreshTTL time.Duration) *Service {
	return &Service{db: db, signer: signer, refreshTTL: refreshTTL}
}

type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	FullName  string    `json:"full_name"`
	CreatedAt time.Time `json:"created_at"`
}

type Tokens struct {
	AccessToken  string    `json:"access_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	RefreshToken string    `json:"refresh_token"`
}

type ClientInfo struct {
	IP        string
	UserAgent string
}

func (s *Service) Register(ctx context.Context, email, fullName, password string, ci ClientInfo) (*User, *Tokens, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	fullName = strings.TrimSpace(fullName)
	if _, err := mail.ParseAddress(email); err != nil || len(email) > 254 {
		return nil, nil, httpx.BadRequest("invalid_email", "invalid email")
	}
	if n := utf8.RuneCountInString(fullName); n < 2 || n > 80 {
		return nil, nil, httpx.BadRequest("invalid_name", "name must be 2-80 characters")
	}
	if err := checkPassword(password); err != nil {
		return nil, nil, err
	}
	hash, err := security.HashPassword(password)
	if err != nil {
		return nil, nil, err
	}

	var u User
	err = s.db.QueryRow(ctx,
		`INSERT INTO users (email, full_name, password_hash) VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO NOTHING
		 RETURNING id, email, full_name, created_at`,
		email, fullName, hash).Scan(&u.ID, &u.Email, &u.FullName, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, errEmailTaken
	}
	if err != nil {
		return nil, nil, err
	}
	t, err := s.newSession(ctx, u.ID, uuid.New(), ci)
	return &u, t, err
}

func (s *Service) Login(ctx context.Context, email, password string, ci ClientInfo) (*User, *Tokens, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var (
		u           User
		hash        string
		lockedUntil *time.Time
	)
	err := s.db.QueryRow(ctx,
		`SELECT id, email, full_name, created_at, password_hash, locked_until FROM users WHERE email = $1`,
		email).Scan(&u.ID, &u.Email, &u.FullName, &u.CreatedAt, &hash, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		security.BurnPasswordCheck(password)
		return nil, nil, errInvalidCredentials
	}
	if err != nil {
		return nil, nil, err
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return nil, nil, errAccountLocked
	}

	ok, err := security.VerifyPassword(password, hash)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		_, err := s.db.Exec(ctx,
			`UPDATE users SET
			   failed_logins = failed_logins + 1,
			   locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + $3::interval ELSE locked_until END
			 WHERE id = $1`,
			u.ID, maxFailedLogins, lockoutDuration.String())
		if err != nil {
			return nil, nil, err
		}
		return nil, nil, errInvalidCredentials
	}
	if _, err := s.db.Exec(ctx, `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, u.ID); err != nil {
		return nil, nil, err
	}
	t, err := s.newSession(ctx, u.ID, uuid.New(), ci)
	return &u, t, err
}

// Refresh rotates a refresh token. Reuse of a revoked token revokes the family.
func (s *Service) Refresh(ctx context.Context, refreshToken string, ci ClientInfo) (*Tokens, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var (
		id, userID, familyID uuid.UUID
		expiresAt            time.Time
		revokedAt            *time.Time
	)
	err = tx.QueryRow(ctx,
		`SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens
		 WHERE token_hash = $1 FOR UPDATE`,
		security.SHA256(refreshToken)).Scan(&id, &userID, &familyID, &expiresAt, &revokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errInvalidRefresh
	}
	if err != nil {
		return nil, err
	}
	if revokedAt != nil {
		if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, familyID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, errInvalidRefresh
	}
	if expiresAt.Before(time.Now()) {
		return nil, errInvalidRefresh
	}
	if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	t, err := s.insertSession(ctx, tx, userID, familyID, ci)
	if err != nil {
		return nil, err
	}
	return t, tx.Commit(ctx)
}

// Logout revokes the whole session family of the given refresh token.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now()
		 WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
		security.SHA256(refreshToken))
	return err
}

// ChangePassword verifies the current password, sets the new one and ends
// every session, including the caller's; the app then signs in again.
func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, current, next string) error {
	var hash string
	if err := s.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return err
	}
	ok, err := security.VerifyPassword(current, hash)
	if err != nil {
		return err
	}
	if !ok {
		return errInvalidCredentials
	}
	if err := checkPassword(next); err != nil {
		return err
	}
	newHash, err := security.HashPassword(next)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, userID, newHash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// LogoutAll revokes every refresh token of the user. Access tokens expire
// within their short TTL.
func (s *Service) LogoutAll(ctx context.Context, userID uuid.UUID) error {
	_, err := s.db.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	return err
}

func (s *Service) Me(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	err := s.db.QueryRow(ctx, `SELECT id, email, full_name, created_at FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.FullName, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.ErrUnauthorized
	}
	return &u, err
}

func (s *Service) newSession(ctx context.Context, userID, familyID uuid.UUID, ci ClientInfo) (*Tokens, error) {
	return s.insertSession(ctx, s.db, userID, familyID, ci)
}

// execer is satisfied by both the pool and a transaction.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (s *Service) insertSession(ctx context.Context, q execer, userID, familyID uuid.UUID, ci ClientInfo) (*Tokens, error) {
	refresh, err := security.RandomToken(32)
	if err != nil {
		return nil, err
	}
	var ip *string
	if ci.IP != "" {
		ip = &ci.IP
	}
	ua := ci.UserAgent
	if len(ua) > 256 {
		ua = ua[:256]
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
		 VALUES ($1, $2, $3, $4, $5, $6::inet)`,
		userID, familyID, security.SHA256(refresh), time.Now().Add(s.refreshTTL), ua, ip); err != nil {
		return nil, err
	}
	access, err := s.signer.Issue(userID)
	if err != nil {
		return nil, err
	}
	return &Tokens{AccessToken: access, ExpiresAt: time.Now().Add(s.signer.TTL()), RefreshToken: refresh}, nil
}

func checkPassword(p string) error {
	if utf8.RuneCountInString(p) < minPasswordLen {
		return httpx.BadRequest("weak_password", "password must be at least 10 characters")
	}
	if len(p) > 256 {
		return httpx.BadRequest("weak_password", "password too long")
	}
	var lower, upper, digit bool
	for _, r := range p {
		switch {
		case r >= 'a' && r <= 'z':
			lower = true
		case r >= 'A' && r <= 'Z':
			upper = true
		case r >= '0' && r <= '9':
			digit = true
		}
	}
	if !(lower && upper && digit) {
		return httpx.BadRequest("weak_password", "password needs upper, lower case letters and a digit")
	}
	return nil
}
