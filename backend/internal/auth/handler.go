package auth

import (
	"net/http"
	"time"

	"hooshban/backend/internal/audit"
	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/ratelimit"
	"hooshban/backend/internal/security"
)

type Handler struct {
	svc        *Service
	signer     *security.Signer
	limiter    *ratelimit.Limiter
	audit      *audit.Log
	trustProxy bool
}

func NewHandler(svc *Service, signer *security.Signer, limiter *ratelimit.Limiter, audit *audit.Log, trustProxy bool) *Handler {
	return &Handler{svc: svc, signer: signer, limiter: limiter, audit: audit, trustProxy: trustProxy}
}

func (h *Handler) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/auth/register", h.register)
	mux.HandleFunc("POST /v1/auth/login", h.login)
	mux.HandleFunc("POST /v1/auth/refresh", h.refresh)
	mux.HandleFunc("POST /v1/auth/logout", h.logout)
	mux.Handle("GET /v1/me", h.Require(http.HandlerFunc(h.me)))
	mux.Handle("POST /v1/me/password", h.Require(http.HandlerFunc(h.changePassword)))
	mux.Handle("POST /v1/me/logout-all", h.Require(http.HandlerFunc(h.logoutAll)))
}

func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r.Context())
	if !h.limiter.Allow(r.Context(), "password:"+uid.String(), 5, 15*time.Minute) {
		httpx.Fail(w, r, httpx.ErrRateLimited)
		return
	}
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.ChangePassword(r.Context(), uid, in.Current, in.New); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.audit.Record(r.Context(), audit.Entry{UserID: uid, Action: "auth.password_change", IP: httpx.ClientIP(r, h.trustProxy)})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) logoutAll(w http.ResponseWriter, r *http.Request) {
	uid := httpx.UserID(r.Context())
	if err := h.svc.LogoutAll(r.Context(), uid); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.audit.Record(r.Context(), audit.Entry{UserID: uid, Action: "auth.logout_all", IP: httpx.ClientIP(r, h.trustProxy)})
	w.WriteHeader(http.StatusNoContent)
}

type sessionResponse struct {
	User   *User   `json:"user,omitempty"`
	Tokens *Tokens `json:"tokens"`
}

func (h *Handler) client(r *http.Request) ClientInfo {
	return ClientInfo{IP: httpx.ClientIP(r, h.trustProxy), UserAgent: r.UserAgent()}
}

// limitIP throttles unauthenticated endpoints per client IP.
func (h *Handler) limitIP(r *http.Request, name string, n int) error {
	if !h.limiter.Allow(r.Context(), name+":"+httpx.ClientIP(r, h.trustProxy), n, time.Minute) {
		return httpx.ErrRateLimited
	}
	return nil
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	if err := h.limitIP(r, "register", 5); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in struct {
		Email    string `json:"email"`
		FullName string `json:"full_name"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	u, t, err := h.svc.Register(r.Context(), in.Email, in.FullName, in.Password, h.client(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	h.audit.Record(r.Context(), audit.Entry{UserID: u.ID, Action: "auth.register", IP: httpx.ClientIP(r, h.trustProxy)})
	httpx.JSON(w, http.StatusCreated, sessionResponse{User: u, Tokens: t})
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	if err := h.limitIP(r, "login", 10); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	ip := httpx.ClientIP(r, h.trustProxy)
	u, t, err := h.svc.Login(r.Context(), in.Email, in.Password, h.client(r))
	if err != nil {
		h.audit.Record(r.Context(), audit.Entry{Action: "auth.login_failed", Target: in.Email, IP: ip})
		httpx.Fail(w, r, err)
		return
	}
	h.audit.Record(r.Context(), audit.Entry{UserID: u.ID, Action: "auth.login", IP: ip})
	httpx.JSON(w, http.StatusOK, sessionResponse{User: u, Tokens: t})
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	if err := h.limitIP(r, "refresh", 30); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	t, err := h.svc.Refresh(r.Context(), in.RefreshToken, h.client(r))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, sessionResponse{Tokens: t})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	if err := h.svc.Logout(r.Context(), in.RefreshToken); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	u, err := h.svc.Me(r.Context(), httpx.UserID(r.Context()))
	if err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, u)
}

// Require rejects requests without a valid access token and applies a
// per-user rate limit.
func (h *Handler) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, err := h.signer.Verify(httpx.BearerToken(r))
		if err != nil {
			httpx.Fail(w, r, httpx.ErrUnauthorized)
			return
		}
		if !h.limiter.Allow(r.Context(), "user:"+uid.String(), 600, time.Minute) {
			httpx.Fail(w, r, httpx.ErrRateLimited)
			return
		}
		next.ServeHTTP(w, r.WithContext(httpx.WithUserID(r.Context(), uid)))
	})
}
