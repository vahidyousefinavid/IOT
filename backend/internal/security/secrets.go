package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
)

// RandomToken returns n random bytes, base64url encoded without padding.
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// SHA256 is used for high-entropy opaque tokens (refresh tokens), where a slow
// KDF adds nothing.
func SHA256(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// Peppered hashes a device secret with a server-side key that is not in the database.
func Peppered(pepper []byte, secret string) []byte {
	m := hmac.New(sha256.New, pepper)
	m.Write([]byte(secret))
	return m.Sum(nil)
}

func EqualBytes(a, b []byte) bool { return subtle.ConstantTimeCompare(a, b) == 1 }

func EqualStrings(a, b string) bool {
	// Hash first so the comparison time does not depend on length.
	return EqualBytes(SHA256(a), SHA256(b))
}
