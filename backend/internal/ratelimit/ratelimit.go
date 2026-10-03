// Package ratelimit implements a fixed-window limiter in Redis, so limits
// hold across every API replica.
package ratelimit

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

type Limiter struct{ rdb *redis.Client }

func New(rdb *redis.Client) *Limiter { return &Limiter{rdb: rdb} }

var incr = redis.NewScript(`
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`)

// Allow reports whether another event under key fits in limit per window.
// If Redis is down it fails open for availability; login lockout in
// PostgreSQL still protects accounts.
func (l *Limiter) Allow(ctx context.Context, key string, limit int, window time.Duration) bool {
	n, err := incr.Run(ctx, l.rdb, []string{"rl:" + key}, window.Milliseconds()).Int()
	if err != nil {
		return true
	}
	return n <= limit
}
