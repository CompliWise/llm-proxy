// Package allowlist enforces a per-organization model allow-list for the proxy.
// An org's list is fetched from the CompliWise api and cached in Redis, keyed
// per organization. Enforcement fails open everywhere except one case: a
// non-empty list that does not contain the requested model.
package allowlist

import (
	"context"
	"log/slog"
	"time"

	redis "github.com/redis/go-redis/v9"
)

// defaultTTL is the fallback Redis cache TTL when config supplies none.
const defaultTTL = 5 * time.Minute

// Resolver returns the model allow-list for an organization. Implementations are
// safe for concurrent use. A nil Resolver is a valid "no enforcement" value; the
// middleware treats it as fail-open.
type Resolver interface {
	// Allowlist returns (models, found, err). found is true when a list was
	// resolved (from cache or a fresh fetch), including an empty list meaning
	// "no restriction". err is returned only for a fetch/backend failure; the
	// caller MUST fail open (forward) on a non-nil err.
	Allowlist(ctx context.Context, orgID string) (models []string, found bool, err error)
}

// redisResolver combines a Redis cache with an api fetcher.
type redisResolver struct {
	cache   *redisCache
	fetcher *fetcher
	ttl     time.Duration
}

// NewResolver builds a Redis-backed resolver. rdb must be non-nil (callers pass
// a nil Resolver instead of building this when Redis is unavailable). apiBaseURL
// and adminSecret configure the outbound fetch; ttl<=0 defaults to five minutes.
func NewResolver(rdb *redis.Client, apiBaseURL, adminSecret string, ttl time.Duration) Resolver {
	if rdb == nil {
		return nil
	}
	if ttl <= 0 {
		ttl = defaultTTL
	}
	return &redisResolver{
		cache:   newRedisCache(rdb, ttl),
		fetcher: newFetcher(apiBaseURL, adminSecret, defaultFetchTimeout),
		ttl:     ttl,
	}
}

// Allowlist resolves orgID's list: cache first, then a fetch on miss. On a
// successful fetch the result (including an empty list) is written back to the
// cache so repeated no-restriction orgs don't hammer the api. A fetch error is
// returned to the caller (which fails open); it is never cached.
func (r *redisResolver) Allowlist(ctx context.Context, orgID string) ([]string, bool, error) {
	if r == nil || orgID == "" {
		return nil, false, nil
	}

	if models, found, err := r.cache.Get(ctx, orgID); err != nil {
		// Cache backend error: log and fall through to a fetch rather than
		// failing. The fetch path still fails open on its own error.
		slog.Debug("allowlist: cache get failed", "org", orgID, "error", err)
	} else if found {
		return models, true, nil
	}

	models, err := r.fetcher.Fetch(ctx, orgID)
	if err != nil {
		return nil, false, err
	}

	if setErr := r.cache.Set(ctx, orgID, models, r.ttl); setErr != nil {
		slog.Debug("allowlist: cache set failed", "org", orgID, "error", setErr)
	}
	return models, true, nil
}
