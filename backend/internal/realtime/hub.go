// Package realtime pushes live site events to the app over WebSocket.
//
// Protocol: the client connects with the access token either as
// "Authorization: Bearer <token>" (native) or as the WebSocket subprotocol
// "bearer.<token>" next to "hooshban.v1" (browsers cannot set headers; the
// token still never appears in a URL or access log), then sends {"type":"subscribe","site_id":"..."}; membership is checked
// before any event of that site is delivered.
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"hooshban/backend/internal/httpx"
	"hooshban/backend/internal/security"
	"hooshban/backend/internal/site"
)

const (
	maxSitesPerConn = 20
	sendBuffer      = 64
)

type conn struct {
	send  chan []byte
	mu    sync.Mutex
	sites map[uuid.UUID]bool
}

type Hub struct {
	signer  *security.Signer
	sites   *site.Service
	origins []string

	mu    sync.RWMutex
	conns map[*conn]struct{}
}

// NewHub accepts browser connections only from origins (host[:port] patterns).
func NewHub(signer *security.Signer, sites *site.Service, origins []string) *Hub {
	return &Hub{signer: signer, sites: sites, origins: origins, conns: map[*conn]struct{}{}}
}

const subprotocol = "hooshban.v1"

func tokenFrom(r *http.Request) string {
	if t := httpx.BearerToken(r); t != "" {
		return t
	}
	for _, p := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
		if t, ok := strings.CutPrefix(strings.TrimSpace(p), "bearer."); ok {
			return t
		}
	}
	return ""
}

// Broadcast delivers a raw event to every connection subscribed to siteID.
// Slow consumers drop messages instead of stalling the hub.
func (h *Hub) Broadcast(siteID uuid.UUID, raw []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.conns {
		c.mu.Lock()
		sub := c.sites[siteID]
		c.mu.Unlock()
		if !sub {
			continue
		}
		select {
		case c.send <- raw:
		default:
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	userID, err := h.signer.Verify(tokenFrom(r))
	if err != nil {
		httpx.Fail(w, r, httpx.ErrUnauthorized)
		return
	}
	// Native apps send no Origin header; browsers must match the host or an
	// explicitly allowed origin (CORS_ORIGINS).
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols:   []string{subprotocol},
		OriginPatterns: h.origins,
	})
	if err != nil {
		return
	}
	ws.SetReadLimit(4 << 10)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	c := &conn{send: make(chan []byte, sendBuffer), sites: map[uuid.UUID]bool{}}
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.conns, c)
		h.mu.Unlock()
	}()

	go h.writeLoop(ctx, cancel, ws, c)
	h.readLoop(ctx, ws, c, userID)
	ws.Close(websocket.StatusNormalClosure, "")
}

func (h *Hub) readLoop(ctx context.Context, ws *websocket.Conn, c *conn, userID uuid.UUID) {
	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var msg struct {
			Type   string    `json:"type"`
			SiteID uuid.UUID `json:"site_id"`
		}
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "subscribe":
			ok := false
			if _, err := h.sites.Authorize(ctx, msg.SiteID, userID, site.RoleGuest); err == nil {
				c.mu.Lock()
				if len(c.sites) < maxSitesPerConn {
					c.sites[msg.SiteID] = true
					ok = true
				}
				c.mu.Unlock()
			}
			h.reply(c, map[string]any{"type": "subscribed", "site_id": msg.SiteID, "ok": ok})
		case "unsubscribe":
			c.mu.Lock()
			delete(c.sites, msg.SiteID)
			c.mu.Unlock()
		}
	}
}

func (h *Hub) reply(c *conn, v any) {
	b, _ := json.Marshal(v)
	select {
	case c.send <- b:
	default:
	}
}

func (h *Hub) writeLoop(ctx context.Context, cancel context.CancelFunc, ws *websocket.Conn, c *conn) {
	defer cancel()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case b := <-c.send:
			wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
			err := ws.Write(wctx, websocket.MessageText, b)
			wcancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, pcancel := context.WithTimeout(ctx, 10*time.Second)
			err := ws.Ping(pctx)
			pcancel()
			if err != nil {
				slog.Debug("ws ping failed", "err", err)
				return
			}
		}
	}
}
