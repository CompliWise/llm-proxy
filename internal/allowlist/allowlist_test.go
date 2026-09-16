package allowlist

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	redis "github.com/redis/go-redis/v9"
)

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	c := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestRedisCache_MissSetHit(t *testing.T) {
	ctx := context.Background()
	c := newRedisCache(newTestRedis(t), time.Minute)

	if _, found, err := c.Get(ctx, "orgA"); err != nil || found {
		t.Fatalf("cold get: found=%v err=%v, want miss", found, err)
	}

	if err := c.Set(ctx, "orgA", []string{"gpt-4o", "gpt-4o-mini"}, time.Minute); err != nil {
		t.Fatalf("set: %v", err)
	}

	models, found, err := c.Get(ctx, "orgA")
	if err != nil || !found {
		t.Fatalf("warm get: found=%v err=%v, want hit", found, err)
	}
	if len(models) != 2 || models[0] != "gpt-4o" {
		t.Fatalf("models=%v", models)
	}
}

// A cached empty list is a HIT ("no restriction"), distinct from a miss — so an
// unrestricted org is served from cache and does not re-hit the api forever.
func TestRedisCache_EmptyListIsAHit(t *testing.T) {
	ctx := context.Background()
	c := newRedisCache(newTestRedis(t), time.Minute)

	if err := c.Set(ctx, "orgA", []string{}, time.Minute); err != nil {
		t.Fatalf("set empty: %v", err)
	}
	models, found, err := c.Get(ctx, "orgA")
	if err != nil || !found {
		t.Fatalf("empty get: found=%v err=%v, want hit", found, err)
	}
	if len(models) != 0 {
		t.Fatalf("models=%v, want empty", models)
	}
}

// The cache key MUST include the org id: one org's list can never be served for
// another org.
func TestRedisCache_PerOrgKeying(t *testing.T) {
	ctx := context.Background()
	c := newRedisCache(newTestRedis(t), time.Minute)

	if err := c.Set(ctx, "orgA", []string{"gpt-4o"}, time.Minute); err != nil {
		t.Fatalf("set: %v", err)
	}
	if _, found, _ := c.Get(ctx, "orgB"); found {
		t.Fatal("orgB must miss — orgA's list must never be served for orgB")
	}
	if c.key("orgA") == c.key("orgB") {
		t.Fatal("cache keys for different orgs must differ")
	}
}

func TestFetcher_HitsVersionedPathWithSecret(t *testing.T) {
	var gotPath, gotSecret string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get("X-AI-Gateway-Admin-Secret")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"organizationId":"orgA","models":["gpt-4o","claude-3-5-sonnet"]}`))
	}))
	defer srv.Close()

	f := newFetcher(srv.URL, "s3cret", time.Second)
	models, err := f.Fetch(context.Background(), "orgA")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if gotPath != "/api/v1/ai-gateway/org/orgA/model-allowlist" {
		t.Fatalf("path=%q, want the /api/v1 versioned allow-list path", gotPath)
	}
	if gotSecret != "s3cret" {
		t.Fatalf("secret header=%q", gotSecret)
	}
	if len(models) != 2 {
		t.Fatalf("models=%v", models)
	}
}

func TestFetcher_Non2xxIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	f := newFetcher(srv.URL, "s3cret", time.Second)
	if _, err := f.Fetch(context.Background(), "orgA"); err == nil {
		t.Fatal("expected error on 500 so the caller fails open")
	}
}

func TestFetcher_EmptyModelsIsNonNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"organizationId":"orgA"}`)) // no models field
	}))
	defer srv.Close()

	f := newFetcher(srv.URL, "s3cret", time.Second)
	models, err := f.Fetch(context.Background(), "orgA")
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if models == nil || len(models) != 0 {
		t.Fatalf("models=%v, want non-nil empty", models)
	}
}

// End-to-end resolver: first call misses the cache and fetches; the result is
// cached so a second call is served without re-hitting the api.
func TestResolver_CachesAfterFetch(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		_, _ = w.Write([]byte(`{"organizationId":"orgA","models":["gpt-4o"]}`))
	}))
	defer srv.Close()

	res := NewResolver(newTestRedis(t), srv.URL, "s3cret", time.Minute)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		models, found, err := res.Allowlist(ctx, "orgA")
		if err != nil || !found || len(models) != 1 {
			t.Fatalf("call %d: models=%v found=%v err=%v", i, models, found, err)
		}
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("api hits=%d, want 1 (subsequent calls must be cache hits)", got)
	}
}

// The resolver must key its cache by org: orgA's fetched list is never returned
// for orgB, and each org triggers its own fetch.
func TestResolver_PerOrgIsolation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/ai-gateway/org/orgA/model-allowlist":
			_, _ = w.Write([]byte(`{"organizationId":"orgA","models":["gpt-4o"]}`))
		case "/api/v1/ai-gateway/org/orgB/model-allowlist":
			_, _ = w.Write([]byte(`{"organizationId":"orgB","models":["claude-3-5-sonnet"]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	res := NewResolver(newTestRedis(t), srv.URL, "s3cret", time.Minute)
	ctx := context.Background()

	a, _, err := res.Allowlist(ctx, "orgA")
	if err != nil || len(a) != 1 || a[0] != "gpt-4o" {
		t.Fatalf("orgA=%v err=%v", a, err)
	}
	b, _, err := res.Allowlist(ctx, "orgB")
	if err != nil || len(b) != 1 || b[0] != "claude-3-5-sonnet" {
		t.Fatalf("orgB=%v err=%v", b, err)
	}
	// Re-read orgA from cache; it must still be its own list, uncontaminated.
	a2, _, _ := res.Allowlist(ctx, "orgA")
	if len(a2) != 1 || a2[0] != "gpt-4o" {
		t.Fatalf("orgA re-read=%v, want its own list", a2)
	}
}

// A fetch failure is returned to the caller (which fails open) and is NOT
// cached, so a later successful fetch can still populate the cache.
func TestResolver_FetchErrorNotCached(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if fail.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(`{"organizationId":"orgA","models":["gpt-4o"]}`))
	}))
	defer srv.Close()

	res := NewResolver(newTestRedis(t), srv.URL, "s3cret", time.Minute)
	ctx := context.Background()

	if _, _, err := res.Allowlist(ctx, "orgA"); err == nil {
		t.Fatal("expected error while the api is down (caller fails open)")
	}
	fail.Store(false)
	models, found, err := res.Allowlist(ctx, "orgA")
	if err != nil || !found || len(models) != 1 {
		t.Fatalf("recovery: models=%v found=%v err=%v", models, found, err)
	}
}

func TestResolver_EmptyOrgIsNoop(t *testing.T) {
	res := NewResolver(newTestRedis(t), "http://127.0.0.1:0", "s3cret", time.Minute)
	models, found, err := res.Allowlist(context.Background(), "")
	if err != nil || found || models != nil {
		t.Fatalf("empty org: models=%v found=%v err=%v, want (nil,false,nil)", models, found, err)
	}
}

func TestNewResolver_NilRedisIsNil(t *testing.T) {
	if r := NewResolver(nil, "http://x", "s", time.Minute); r != nil {
		t.Fatal("nil redis client must yield a nil Resolver (fail-open)")
	}
}
