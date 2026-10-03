package security

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("Correct-Horse-9")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$") {
		t.Fatalf("unexpected format %q", h)
	}
	if ok, _ := VerifyPassword("Correct-Horse-9", h); !ok {
		t.Error("correct password rejected")
	}
	if ok, _ := VerifyPassword("correct-horse-9", h); ok {
		t.Error("wrong password accepted")
	}
	if _, err := VerifyPassword("x", "$bcrypt$garbage"); err == nil {
		t.Error("malformed hash accepted")
	}
}

func TestSignerRejectsTampering(t *testing.T) {
	s, _ := NewSigner(make([]byte, 32), "hooshban", time.Minute)
	id := uuid.New()
	tok, err := s.Issue(id)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Verify(tok)
	if err != nil || got != id {
		t.Fatalf("verify: %v %v", got, err)
	}

	// Token from a different key.
	other, _ := NewSigner(nil, "hooshban", time.Minute)
	foreign, _ := other.Issue(id)
	if _, err := s.Verify(foreign); err == nil {
		t.Error("token signed by another key accepted")
	}

	// alg=none.
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.RegisteredClaims{
		Subject: id.String(), Issuer: "hooshban", Audience: jwt.ClaimStrings{"hooshban-app"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, err := s.Verify(none); err == nil {
		t.Error("alg=none token accepted")
	}

	// Expired.
	short, _ := NewSigner(make([]byte, 32), "hooshban", -time.Minute)
	expired, _ := short.Issue(id)
	if _, err := s.Verify(expired); err == nil {
		t.Error("expired token accepted")
	}
}

func TestPeppered(t *testing.T) {
	a := Peppered([]byte("k1"), "secret")
	if EqualBytes(a, Peppered([]byte("k2"), "secret")) {
		t.Error("pepper has no effect")
	}
	if !EqualBytes(a, Peppered([]byte("k1"), "secret")) {
		t.Error("not deterministic")
	}
}
