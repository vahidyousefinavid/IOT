// Package mqttauth answers EMQX's HTTP authentication and authorization
// callbacks. It is served on the internal listener only.
//
// Each device gets its own username ({siteID}.{deviceID}) and random secret,
// and may only publish/subscribe under its own topic root. A compromised
// device therefore cannot read or control anything else — not even other
// devices in the same home.
package mqttauth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hooshban/backend/internal/protocol"
	"hooshban/backend/internal/security"
)

type Handler struct {
	db           *pgxpool.Pool
	pepper       []byte
	token        string
	coreUser     string
	corePassword string
}

func New(db *pgxpool.Pool, pepper []byte, token, coreUser, corePassword string) *Handler {
	return &Handler{db: db, pepper: pepper, token: token, coreUser: coreUser, corePassword: corePassword}
}

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.Handle("POST /internal/mqtt/authn", h.guard(h.authn))
	mux.Handle("POST /internal/mqtt/authz", h.guard(h.authz))
}

func (h *Handler) guard(fn http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.token == "" || !security.EqualStrings(r.Header.Get("X-Internal-Token"), h.token) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
		fn(w, r)
	})
}

func reply(w http.ResponseWriter, allow, superuser bool) {
	res := "deny"
	if allow {
		res = "allow"
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"result": res, "is_superuser": superuser})
}

func (h *Handler) authn(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		ClientID string `json:"clientid"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		reply(w, false, false)
		return
	}
	allow, super := h.Authenticate(r.Context(), in.Username, in.Password, in.ClientID)
	reply(w, allow, super)
}

func (h *Handler) authz(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Topic    string `json:"topic"`
		Action   string `json:"action"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		reply(w, false, false)
		return
	}
	reply(w, h.Authorize(in.Username, in.Topic), false)
}

// Authenticate checks a connecting MQTT client. It is shared by the EMQX HTTP
// callback and the embedded broker, so both enforce identical rules.
func (h *Handler) Authenticate(ctx context.Context, username, password, clientID string) (allow, superuser bool) {
	if username == h.coreUser {
		ok := h.corePassword != "" && security.EqualStrings(password, h.corePassword)
		return ok, ok
	}
	siteID, deviceID, ok := parseUsername(username)
	// Pinning client ID to username stops one device from kicking another off.
	if !ok || clientID != username {
		return false, false
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var hash []byte
	err := h.db.QueryRow(ctx,
		`SELECT c.secret_hash FROM device_credentials c JOIN devices d ON d.id = c.device_id
		 WHERE c.device_id = $1 AND d.site_id = $2 AND c.revoked_at IS NULL`,
		deviceID, siteID).Scan(&hash)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("mqtt authn lookup", "err", err)
		}
		return false, false
	}
	return security.EqualBytes(security.Peppered(h.pepper, password), hash), false
}

// Authorize is pure: the username was verified at connect and encodes the
// only topic root the device may touch. The first three levels are matched
// literally, so wildcards after them (bridges subscribe to root/#) cannot
// escape the device's own root. Superusers are handled by the caller.
func (h *Handler) Authorize(username, topic string) bool {
	siteID, deviceID, ok := parseUsername(username)
	if !ok {
		return false
	}
	return strings.HasPrefix(topic, protocol.Root(siteID.String(), deviceID.String())+"/")
}

// CoreUser is the platform's own broker account (full access).
func (h *Handler) CoreUser() string { return h.coreUser }

func parseUsername(u string) (uuid.UUID, uuid.UUID, bool) {
	a, b, ok := strings.Cut(u, ".")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	siteID, err1 := uuid.Parse(a)
	deviceID, err2 := uuid.Parse(b)
	if err1 != nil || err2 != nil {
		return uuid.Nil, uuid.Nil, false
	}
	return siteID, deviceID, true
}
