package site

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"hooshban/backend/internal/audit"
	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/ratelimit"
)

type Handler struct {
	svc        *Service
	require    httpx.Middleware
	limiter    *ratelimit.Limiter
	audit      *audit.Log
	trustProxy bool
}

func NewHandler(svc *Service, require httpx.Middleware, limiter *ratelimit.Limiter, audit *audit.Log, trustProxy bool) *Handler {
	return &Handler{svc: svc, require: require, limiter: limiter, audit: audit, trustProxy: trustProxy}
}

// scoped is a handler for a route under /v1/sites/{siteID}, called after
// the caller's membership and minimum role were verified.
type scoped func(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, role Role)

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.Handle("GET /v1/sites", h.require(http.HandlerFunc(h.list)))
	mux.Handle("POST /v1/sites", h.require(http.HandlerFunc(h.create)))
	mux.Handle("POST /v1/invites/redeem", h.require(http.HandlerFunc(h.redeem)))

	route := func(pattern string, min Role, fn scoped) {
		mux.Handle(pattern, h.require(h.authorize(min, fn)))
	}
	route("PATCH /v1/sites/{siteID}", RoleAdmin, h.update)
	route("DELETE /v1/sites/{siteID}", RoleOwner, h.delete)

	route("GET /v1/sites/{siteID}/rooms", RoleGuest, h.rooms)
	route("POST /v1/sites/{siteID}/rooms", RoleAdmin, h.createRoom)
	route("PATCH /v1/sites/{siteID}/rooms/{roomID}", RoleAdmin, h.updateRoom)
	route("DELETE /v1/sites/{siteID}/rooms/{roomID}", RoleAdmin, h.deleteRoom)

	route("GET /v1/sites/{siteID}/members", RoleGuest, h.members)
	route("PATCH /v1/sites/{siteID}/members/{userID}", RoleAdmin, h.setRole)
	route("DELETE /v1/sites/{siteID}/members/{userID}", RoleGuest, h.removeMember)

	route("GET /v1/sites/{siteID}/invites", RoleAdmin, h.invites)
	route("POST /v1/sites/{siteID}/invites", RoleAdmin, h.createInvite)
	route("DELETE /v1/sites/{siteID}/invites/{inviteID}", RoleAdmin, h.revokeInvite)
}

func (h *Handler) authorize(min Role, fn scoped) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		siteID, err := httpx.PathUUID(r, "siteID")
		var role Role
		if err == nil {
			role, err = h.svc.Authorize(r.Context(), siteID, httpx.UserID(r.Context()), min)
		}
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		fn(w, r, siteID, role)
	})
}

func (h *Handler) record(r *http.Request, siteID uuid.UUID, action, target string, meta map[string]any) {
	h.audit.Record(r.Context(), audit.Entry{
		UserID: httpx.UserID(r.Context()), SiteID: siteID, Action: action, Target: target,
		IP: httpx.ClientIP(r, h.trustProxy), Meta: meta,
	})
}

// respond writes v, or the error if err is set.
func respond(w http.ResponseWriter, r *http.Request, status int, v any, err error) {
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if v == nil {
		w.WriteHeader(status)
		return
	}
	httpx.JSON(w, status, v)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	sites, err := h.svc.List(r.Context(), httpx.UserID(r.Context()))
	respond(w, r, http.StatusOK, map[string]any{"sites": sites}, err)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	s, err := h.svc.Create(r.Context(), httpx.UserID(r.Context()), in.Name, in.Kind)
	if err == nil {
		h.record(r, s.ID, "site.create", in.Name, nil)
	}
	respond(w, r, http.StatusCreated, s, err)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	var in struct {
		Name     *string `json:"name"`
		Timezone *string `json:"timezone"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	s, err := h.svc.Update(r.Context(), siteID, in.Name, in.Timezone)
	respond(w, r, http.StatusOK, s, err)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	err := h.svc.Delete(r.Context(), siteID)
	if err == nil {
		h.record(r, uuid.Nil, "site.delete", siteID.String(), nil)
	}
	respond(w, r, http.StatusNoContent, nil, err)
}

func (h *Handler) rooms(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	rooms, err := h.svc.Rooms(r.Context(), siteID)
	respond(w, r, http.StatusOK, map[string]any{"rooms": rooms}, err)
}

type roomInput struct {
	Name *string `json:"name"`
	Icon *string `json:"icon"`
}

func (h *Handler) createRoom(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	var in roomInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	name, icon := "", ""
	if in.Name != nil {
		name = *in.Name
	}
	if in.Icon != nil {
		icon = *in.Icon
	}
	room, err := h.svc.CreateRoom(r.Context(), siteID, name, icon)
	respond(w, r, http.StatusCreated, room, err)
}

func (h *Handler) updateRoom(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	roomID, err := httpx.PathUUID(r, "roomID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in roomInput
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	room, err := h.svc.UpdateRoom(r.Context(), siteID, roomID, in.Name, in.Icon)
	respond(w, r, http.StatusOK, room, err)
}

func (h *Handler) deleteRoom(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	roomID, err := httpx.PathUUID(r, "roomID")
	if err == nil {
		err = h.svc.DeleteRoom(r.Context(), siteID, roomID)
	}
	respond(w, r, http.StatusNoContent, nil, err)
}

func (h *Handler) members(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	m, err := h.svc.Members(r.Context(), siteID)
	respond(w, r, http.StatusOK, map[string]any{"members": m}, err)
}

func (h *Handler) setRole(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, actor Role) {
	target, err := httpx.PathUUID(r, "userID")
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in struct {
		Role Role `json:"role"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	err = h.svc.SetRole(r.Context(), siteID, actor, target, in.Role)
	if err == nil {
		h.record(r, siteID, "member.role", target.String(), map[string]any{"role": in.Role})
	}
	respond(w, r, http.StatusNoContent, nil, err)
}

func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, actor Role) {
	target, err := httpx.PathUUID(r, "userID")
	if err == nil {
		err = h.svc.RemoveMember(r.Context(), siteID, httpx.UserID(r.Context()), actor, target)
	}
	if err == nil {
		h.record(r, siteID, "member.remove", target.String(), nil)
	}
	respond(w, r, http.StatusNoContent, nil, err)
}

func (h *Handler) invites(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	inv, err := h.svc.Invites(r.Context(), siteID)
	respond(w, r, http.StatusOK, map[string]any{"invites": inv}, err)
}

func (h *Handler) createInvite(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, actor Role) {
	var in struct {
		Role Role `json:"role"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	inv, err := h.svc.CreateInvite(r.Context(), siteID, httpx.UserID(r.Context()), actor, in.Role)
	if err == nil {
		h.record(r, siteID, "invite.create", inv.ID.String(), map[string]any{"role": in.Role})
	}
	respond(w, r, http.StatusCreated, inv, err)
}

func (h *Handler) revokeInvite(w http.ResponseWriter, r *http.Request, siteID uuid.UUID, _ Role) {
	id, err := httpx.PathUUID(r, "inviteID")
	if err == nil {
		err = h.svc.RevokeInvite(r.Context(), siteID, id)
	}
	respond(w, r, http.StatusNoContent, nil, err)
}

func (h *Handler) redeem(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r.Context())
	// Codes are short, so guessing is throttled hard per user.
	if !h.limiter.Allow(r.Context(), "redeem:"+uid.String(), 10, time.Hour) {
		httpx.Fail(w, r, httpx.ErrRateLimited)
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	s, err := h.svc.Redeem(r.Context(), uid, in.Code)
	if err == nil {
		h.record(r, s.ID, "invite.redeem", "", map[string]any{"role": s.Role})
	}
	respond(w, r, http.StatusOK, s, err)
}
