package security

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Signer issues and verifies short-lived Ed25519 (EdDSA) access tokens.
type Signer struct {
	priv     ed25519.PrivateKey
	pub      ed25519.PublicKey
	issuer   string
	ttl      time.Duration
	audience string
}

// NewSigner derives the key from seed; a nil seed creates an ephemeral key
// (development only — tokens are invalidated on restart).
func NewSigner(seed []byte, issuer string, ttl time.Duration) (*Signer, error) {
	var priv ed25519.PrivateKey
	if seed == nil {
		_, p, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		priv = p
	} else {
		priv = ed25519.NewKeyFromSeed(seed)
	}
	return &Signer{
		priv:     priv,
		pub:      priv.Public().(ed25519.PublicKey),
		issuer:   issuer,
		ttl:      ttl,
		audience: "hooshban-app",
	}, nil
}

func (s *Signer) TTL() time.Duration { return s.ttl }

func (s *Signer) Issue(userID uuid.UUID) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   userID.String(),
		Issuer:    s.issuer,
		Audience:  jwt.ClaimStrings{s.audience},
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		ID:        uuid.NewString(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(s.priv)
}

var ErrInvalidToken = errors.New("invalid token")

func (s *Signer) Verify(token string) (uuid.UUID, error) {
	var claims jwt.RegisteredClaims
	_, err := jwt.ParseWithClaims(token, &claims,
		func(*jwt.Token) (any, error) { return s.pub, nil },
		// Pinning the algorithm blocks "alg: none" and key-confusion attacks.
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(s.issuer),
		jwt.WithAudience(s.audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(5*time.Second),
	)
	if err != nil {
		return uuid.Nil, ErrInvalidToken
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, ErrInvalidToken
	}
	return id, nil
}
