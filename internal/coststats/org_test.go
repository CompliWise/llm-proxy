package coststats

import (
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/alicebob/miniredis/v2"
)

// Two orgs' requests must produce separate by_org members, an org-less request
// must not create a phantom member, and one org's totals must exclude another's.
func TestRecorderAggregatesByOrg_NoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordRequest("openai", "iw:a", "u1", "gpt-4o", "org-1", 0.01, 0.006, 0.004, 10, 5)
	r.RecordRequest("openai", "iw:b", "u2", "gpt-4o", "org-2", 0.02, 0.012, 0.008, 20, 10)
	// org-less (legacy) request must NOT create a by_org member.
	r.RecordRequest("openai", "iw:c", "u3", "gpt-4o", "", 0.05, 0.03, 0.02, 50, 25)

	snap := r.Snapshot()
	byOrg, ok := snap["by_org"].(map[string]map[string]float64)
	if !ok {
		t.Fatalf("by_org type = %T", snap["by_org"])
	}
	if len(byOrg) != 2 {
		t.Fatalf("by_org len = %d, want 2 (org-less must not create a member)", len(byOrg))
	}
	if _, phantom := byOrg[""]; phantom {
		t.Fatal("phantom empty-org member recorded")
	}
	if got := byOrg["org-1"]["spend_usd"]; got != 0.01 {
		t.Fatalf("org-1 spend = %v, want 0.01 (must exclude org-2)", got)
	}
	if got := byOrg["org-2"]["spend_usd"]; got != 0.02 {
		t.Fatalf("org-2 spend = %v, want 0.02", got)
	}
	if got := byOrg["org-1"]["requests"]; got != 1 {
		t.Fatalf("org-1 requests = %v, want 1", got)
	}
	if got := byOrg["org-1"]["input_tokens"]; got != 10 {
		t.Fatalf("org-1 input_tokens = %v, want 10", got)
	}
}

// by_org must round-trip through the shared rollup store: an instance records +
// flushes, and a fresh instance bound to the same store reads it back via
// MergeToday (fleet-wide read path from Redis aggregates).
func TestRecorderByOrgRoundTripsThroughRollup(t *testing.T) {
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
	r.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricCost))
	r.RecordRequest("openai", "iw:a", "u1", "gpt-4o", "org-1", 1.0, 0.6, 0.4, 10, 5)
	r.RecordRequest("openai", "iw:b", "u2", "gpt-4o", "org-2", 2.0, 1.2, 0.8, 20, 10)
	r.FlushRollup() // force the debounced delta into Redis

	// A fresh recorder with zero local state must see both orgs via the store.
	fresh := NewRecorder()
	fresh.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricCost))
	day := time.Now().UTC().Format("2006-01-02")
	snap := map[string]interface{}{}
	fresh.MergeToday(adminrollup.MetricCost, day, snap, costRollupCaps)

	byOrg := adminrollup.DimMapFromSnap(snap["by_org"])
	if got := byOrg["org-1"]["spend_usd"]; got != 1.0 {
		t.Fatalf("fleet org-1 spend = %v, want 1.0", got)
	}
	if got := byOrg["org-2"]["spend_usd"]; got != 2.0 {
		t.Fatalf("fleet org-2 spend = %v, want 2.0", got)
	}
}
