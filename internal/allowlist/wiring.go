package allowlist

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Instawork/llm-proxy/internal/config"
	redis "github.com/redis/go-redis/v9"
)

// apiBaseURLEnvFallback is consulted when features.model_allowlist.api_base_url
// is empty, so the api origin can be supplied purely via environment.
const apiBaseURLEnvFallback = "AI_GATEWAY_API_BASE_URL"

// adminSecretEnv is the shared portal admin secret the proxy also validates
// inbound; the same value authenticates the outbound allow-list fetch.
const adminSecretEnv = "AI_GATEWAY_ADMIN_SYNC_SECRET"

// NewResolverFromConfig builds a Redis-backed resolver from the model-allowlist
// feature config. It returns (nil, nil, nil) when the feature is disabled — the
// middleware treats a nil Resolver as "no enforcement" (fail open). A malformed
// Redis URL is surfaced as an error so a real misconfiguration is visible; the
// caller should log it and proceed WITHOUT a resolver (fail open) rather than
// refuse to boot. No startup ping is performed on purpose: a transient Redis
// blip at boot must not permanently disable enforcement — per-request cache
// errors already fall through to a fetch, and fetch errors fail open.
func NewResolverFromConfig(cfg config.ModelAllowlistConfig) (Resolver, func() error, error) {
	if !cfg.Enabled {
		return nil, nil, nil
	}

	rdb, err := newRedisClient(cfg.Redis)
	if err != nil {
		return nil, nil, err
	}

	apiBase := strings.TrimSpace(os.ExpandEnv(cfg.APIBaseURL))
	if apiBase == "" {
		apiBase = strings.TrimSpace(os.Getenv(apiBaseURLEnvFallback))
	}

	adminSecret := strings.TrimSpace(os.Getenv(adminSecretEnv))

	ttl := time.Duration(cfg.TTLSeconds) * time.Second // <=0 defaults inside NewResolver

	resolver := NewResolver(rdb, apiBase, adminSecret, ttl)
	if resolver == nil {
		_ = rdb.Close()
		return nil, nil, nil
	}
	return resolver, rdb.Close, nil
}

// newRedisClient constructs a *redis.Client from a RedisConfig, mirroring the
// PII analyze-cache builder: a full URL takes priority (with optional
// Address/Password/DB overrides), else Address/Password/DB (defaulting to
// localhost:6379). Env references in URL/Address/Password are expanded here.
func newRedisClient(r *config.RedisConfig) (*redis.Client, error) {
	if r == nil {
		return nil, fmt.Errorf("allowlist: redis config is required when model_allowlist is enabled")
	}

	url := strings.TrimSpace(os.ExpandEnv(r.URL))
	addr := strings.TrimSpace(os.ExpandEnv(r.Address))
	password := os.ExpandEnv(r.Password)

	var opts *redis.Options
	if url != "" {
		parsed, err := redis.ParseURL(url)
		if err != nil {
			return nil, fmt.Errorf("allowlist redis URL: %w", err)
		}
		opts = parsed
		if addr != "" {
			opts.Addr = addr
		}
		if password != "" {
			opts.Password = password
		}
		if r.DBSet {
			opts.DB = r.DB
		}
	} else {
		if addr == "" {
			addr = "localhost:6379"
		}
		opts = &redis.Options{Addr: addr, Password: password, DB: r.DB}
	}

	return redis.NewClient(opts), nil
}
