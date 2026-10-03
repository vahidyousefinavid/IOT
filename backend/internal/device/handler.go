package device

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"hooshban/backend/internal/audit"
	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/site"
)

type Handler struct {
	svc        *Service
	sites      *site.Service
	audit      *audit.Log
	require    httpx.Middleware
	trustProxy bool
}

func NewHandler(svc *Service, sites *site.Service, audit *audit.Log, require httpx.Middleware, trustProxy bool) *Handler {
	return &Handler{svc: svc, sites: sites, audit: audit, require: require, trustProxy: trustProxy}
}

func (h *Handler) Routes(mux *http.ServeMux) {
	route := func(pattern string, min site.Role, fn func(http.ResponseWriter, *http.Request, uuid.UUID)) {
		mux.Handle(pattern, h.require(h.authorize(min, fn)))
	}
	route("GET /v1/sites/{siteID}/devices", site.RoleGuest, h.list)
	route("POST /v1/sites/{siteID}/devices", site.RoleAdmin, h.create)
	route("GET /v1/sites/{siteID}/devices/{deviceID}", site.RoleGuest, h.get)
	route("PATCH /v1/sites/{siteID}/devices/{deviceID}", site.RoleAdmin, h.update)
	route("DELETE /v1/sites/{siteID}/devices/{deviceID}", site.RoleAdmin, h.delete)
	route("POST /v1/sites/{siteID}/devices/{deviceID}/commands", site.RoleMember, h.command)
	route("POST /v1/sites/{siteID}/devices/{deviceID}/credentials", site.RoleAdmin, h.rotate)
	route("GET /v1/sites/{siteID}/devices/{deviceID}/history", site.RoleGuest, h.history)
	route("GET /v1/sites/{siteID}/devices/{deviceID}/track", site.RoleGuest, h.track)
}

// authorize resolves the site from the path and checks the caller's role.
func (h *Handler) authorize(min site.Role, fn func(http.ResponseWriter, *http.Request, uuid.UUID)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		siteID, err := httpx.PathUUID(r, "siteID")
		if err == nil {
			_, err = h.sites.Authorize(r.Context(), siteID, httpx.UserID(r.Context()), min)
		}
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		fn(w, r, siteID)
	})
}

func (h *Handler) record(r *http.Request, siteID uuid.UUID, action, target string, meta map[string]any) {
	h.audit.Record(r.Context(), audit.Entry{
		UserID: httpx.UserID(r.Context()), SiteID: siteID, Action: action, Target: target,
		IP: httpx.ClientIP(r, h.trustProxy), Meta: meta,
	})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	ds, err := h.svc.List(r.Context(), siteID)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"devices": ds})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	d, err := h.svc.Get(r.Context(), siteID, id)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	var in CreateInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	d, creds, err := h.svc.Create(r.Context(), siteID, in)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.record(r, siteID, "device.create", d.ID.String(), map[string]any{"protocol": d.Protocol})
	httpx.JSON(w, http.StatusCreated, map[string]any{"device": d, "credentials": creds})
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in UpdateInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	d, err := h.svc.Update(r.Context(), siteID, id, in)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err == nil {
		err = h.svc.Delete(r.Context(), siteID, id)
	}
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.record(r, siteID, "device.delete", id.String(), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) command(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var cmd map[string]any
	if err := httpx.Decode(r, &cmd); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.Command(r.Context(), siteID, id, cmd); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	action := "device.command"
	if _, ok := cmd["immobilized"]; ok {
		action = "tracker.immobilize" // safety-relevant, easy to find in the audit log
	}
	h.record(r, siteID, action, id.String(), cmd)
	w.WriteHeader(http.StatusAccepted)
}

func (h *Handler) rotate(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	creds, err := h.svc.RotateCredentials(r.Context(), siteID, id)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.record(r, siteID, "device.rotate_credentials", id.String(), nil)
	httpx.JSON(w, http.StatusOK, creds)
}

var ranges = map[string]struct{ since, bucket time.Duration }{
	"24h": {24 * time.Hour, 15 * time.Minute},
	"7d":  {7 * 24 * time.Hour, 2 * time.Hour},
	"30d": {30 * 24 * time.Hour, 6 * time.Hour},
}

func (h *Handler) history(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	rg, ok := ranges[r.URL.Query().Get("range")]
	if !ok {
		rg = ranges["24h"]
	}
	pts, err := h.svc.History(r.Context(), siteID, id, r.URL.Query().Get("key"), rg.since, rg.bucket)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"points": pts})
}

func (h *Handler) track(w http.ResponseWriter, r *http.Request, siteID uuid.UUID) {
	id, err := httpx.PathUUID(r, "deviceID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	rg, ok := ranges[r.URL.Query().Get("range")]
	if !ok {
		rg = ranges["24h"]
	}
	pts, err := h.svc.Track(r.Context(), siteID, id, rg.since)
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"points": pts})
}
