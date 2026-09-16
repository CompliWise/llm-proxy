package allowlist

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	redis "github.com/redis/go-redis/v9"
)

// redisKeyPrefix namespaces per-organization allow-lists. The organization id is
// appended so one org's cached list can NEVER be served for another org.
const redisKeyPrefix = "llm:allowlist:org:"

// redisCache stores a per-organization model allow-list (a JSON string array) in
// Redis with a TTL. A cached empty list ("[]") is a valid, distinct-from-miss
// value: it encodes "this org has no restriction" so repeated lookups for an
// unrestricted org are served from cache instead of re-hitting the api.
type redisCache struct {
	rdb *redis.Client
	ttl time.Duration
}

func newRedisCache(rdb *redis.Client, ttl time.Duration) *redisCache {
	return &redisCache{rdb: rdb, ttl: ttl}
}

func (c *redisCache) key(orgID string) string {
	return redisKeyPrefix + orgID
}

// Get returns the cached allow-list for orgID. found is false on a cache miss
// (redis.Nil); err is non-nil only for a real backend error (never for a miss).
// A cached "[]" returns (empty-non-nil slice, true, nil). A decode error is
// treated as a miss so the caller refetches rather than failing.
func (c *redisCache) Get(ctx context.Context, orgID string) (models []string, found bool, err error) {
	data, err := c.rdb.Get(ctx, c.key(orgID)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, false, nil
		}
		return nil, false, err
	}
	var decoded []string
	if uerr := json.Unmarshal(data, &decoded); uerr != nil {
		slog.Debug("allowlist: cache decode failed", "org", orgID, "error", uerr)
		return nil, false, nil
	}
	if decoded == nil {
		decoded = []string{}
	}
	return decoded, true, nil
}

// Set stores models for orgID with the given TTL (SETEX semantics via go-redis
// Set with a positive expiration). A nil slice is stored as "[]" so it reads
// back as a hit, not a miss.
func (c *redisCache) Set(ctx context.Context, orgID string, models []string, ttl time.Duration) error {
	if models == nil {
		models = []string{}
	}
	data, err := json.Marshal(models)
	if err != nil {
		return err
	}
	return c.rdb.Set(ctx, c.key(orgID), data, ttl).Err()
}
