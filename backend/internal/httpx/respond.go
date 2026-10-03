// Package httpx holds HTTP plumbing shared by every handler: JSON I/O,
// error envelopes and middleware.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// Error is an API error. Code is a stable machine-readable string the app
// maps to a localized (Persian) message; Message is for developers.
type Error struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func NewError(status int, code, msg string) *Error { return &Error{status, code, msg} }

var (
	ErrUnauthorized = NewError(http.StatusUnauthorized, "unauthorized", "authentication required")
	ErrForbidden    = NewError(http.StatusForbidden, "forbidden", "not allowed")
	ErrNotFound     = NewError(http.StatusNotFound, "not_found", "resource not found")
	ErrRateLimited  = NewError(http.StatusTooManyRequests, "rate_limited", "too many requests")
)

func BadRequest(code, msg string) *Error { return NewError(http.StatusBadRequest, code, msg) }

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// Fail writes err; anything that is not an *Error is logged and hidden
// behind a generic 500 so internals never leak to clients.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		JSON(w, e.Status, map[string]any{"error": e})
		return
	}
	slog.ErrorContext(r.Context(), "internal error", "err", err, "path", r.URL.Path, "request_id", RequestID(r.Context()))
	JSON(w, http.StatusInternalServerError, map[string]any{
		"error": NewError(http.StatusInternalServerError, "internal", "internal error"),
	})
}

// Decode reads a JSON body strictly: unknown fields and trailing data are rejected.
func Decode(r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return NewError(http.StatusUnsupportedMediaType, "unsupported_media_type", "expected application/json")
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return NewError(http.StatusRequestEntityTooLarge, "body_too_large", "request body too large")
		}
		return BadRequest("invalid_json", "malformed JSON body")
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return BadRequest("invalid_json", "body must contain a single JSON object")
	}
	return nil
}

func PathUUID(r *http.Request, name string) (uuid.UUID, error) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		return uuid.Nil, ErrNotFound
	}
	return id, nil
}
