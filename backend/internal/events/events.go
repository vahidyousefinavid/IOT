// Package events fans out site events across API replicas through Redis
// pub/sub, so a WebSocket client receives updates no matter which replica
// ingested the MQTT message.
package events

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Event struct {
	Type     string         `json:"type"`
	SiteID   uuid.UUID      `json:"site_id"`
	DeviceID uuid.UUID      `json:"device_id,omitempty"`
	Data     map[string]any `json:"data,omitempty"`
}

const channelPrefix = "site:"

type Bus struct{ rdb *redis.Client }

func NewBus(rdb *redis.Client) *Bus { return &Bus{rdb: rdb} }

func (b *Bus) Publish(ctx context.Context, e Event) {
	payload, err := json.Marshal(e)
	if err != nil {
		return
	}
	if err := b.rdb.Publish(ctx, channelPrefix+e.SiteID.String(), payload).Err(); err != nil {
		slog.Warn("event publish failed", "err", err)
	}
}

// Subscribe delivers every site event to fn until ctx is cancelled.
func (b *Bus) Subscribe(ctx context.Context, fn func(siteID uuid.UUID, raw []byte)) {
	sub := b.rdb.PSubscribe(ctx, channelPrefix+"*")
	defer sub.Close()
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-ch:
			if !ok {
				return
			}
			id, err := uuid.Parse(m.Channel[len(channelPrefix):])
			if err != nil {
				continue
			}
			fn(id, []byte(m.Payload))
		}
	}
}
