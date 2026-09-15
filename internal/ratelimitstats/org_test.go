package ratelimitstats

import (
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/alicebob/miniredis/v2"
)

func TestRateLimitRecorderAggregatesByOrg_NoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordDecision("openai", "gpt-4o", "iw:a", "u1", "org-1", true, "", "", "", "", 0, 0)
	r.RecordDecision("openai", "gpt-4o", "iw:b", "u2", "org-2", true, "", "", "", "", 0, 0)
	r.RecordDecision("openai", "gpt-4o", "iw:b", "u2", "org-2", false, "rpm", "requests", "minute", "k", 1, 0)
	// org-less decision must not create a by_org member.
	r.RecordDecision("openai", "gpt-4o", "iw:c", "u3", "", true, "", "", "", "", 0, 0)

	snap := r.Snapshot()
	byOrg, ok := snap["by_org"].(map[string]map[string]float64)
	if !ok {
		t.Fatalf("by_org type = %T", snap["by_org"])
	}
	if len(byOrg) != 2 {
		t.Fatalf("by_org len = %d, want 2", len(byOrg))
	}
	if _, phantom := byOrg[""]; phantom {
		t.Fatal("phantom empty-org member recorded")
	}
	if got := byOrg["org-1"]["requests_total"]; got != 1 {
		t.Fatalf("org-1 requests_total = %v, want 1", got)
	}
	if got := byOrg["org-2"]["requests_total"]; got != 2 {
		t.Fatalf("org-2 requests_total = %v, want 2", got)
	}
	if got := byOrg["org-2"]["requests_blocked"]; got != 1 {
		t.Fatalf("org-2 requests_blocked = %v, want 1", got)
	}
	if got := byOrg["org-1"]["requests_blocked"]; got != 0 {
		t.Fatalf("org-1 requests_blocked = %v, want 0 (must exclude org-2)", got)
	}
}

func TestRateLimitRecorderByOrgRoundTripsThroughRollup(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()
	store, err := adminrollup.NewStore(adminrollup.Config{
		Enabled: true,
		Redis:   &config.RedisConfig{Address: mr.Addr(), DB: 6, DBSet: true},
	})
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer store.Close()

	r := NewRecorder()
	r.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricRateLimit))
	r.RecordDecision("openai", "gpt-4o", "iw:a", "u1", "org-1", false, "rpm", "requests", "minute", "k", 1, 0)
	r.FlushRollup()

	fresh := NewRecorder()
	fresh.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricRateLimit))
	day := time.Now().UTC().Format("2006-01-02")
	snap := map[string]interface{}{}
	fresh.MergeToday(adminrollup.MetricRateLimit, day, snap, adminrollup.TopNCaps{})

	byOrg := adminrollup.DimMapFromSnap(snap["by_org"])
	if got := byOrg["org-1"]["requests_total"]; got != 1 {
		t.Fatalf("fleet org-1 requests_total = %v, want 1", got)
	}
	if got := byOrg["org-1"]["requests_blocked"]; got != 1 {
		t.Fatalf("fleet org-1 requests_blocked = %v, want 1", got)
	}
}
