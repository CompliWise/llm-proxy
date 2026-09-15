package usagestats

import (
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/alicebob/miniredis/v2"
)

func TestUsageRecorderAggregatesByOrg_NoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordRequest("openai", "gpt-4o", "iw:a", "u1", "org-1", 100, 50)
	r.RecordRequest("openai", "gpt-4o", "iw:b", "u2", "org-2", 200, 100)
	// org-less request must not create a by_org member.
	r.RecordRequest("openai", "gpt-4o", "iw:c", "u3", "", 10, 5)

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
	if got := byOrg["org-1"]["tokens"]; got != 150 {
		t.Fatalf("org-1 tokens = %v, want 150", got)
	}
	if got := byOrg["org-1"]["requests"]; got != 1 {
		t.Fatalf("org-1 requests = %v, want 1", got)
	}
	if got := byOrg["org-2"]["tokens"]; got != 300 {
		t.Fatalf("org-2 tokens = %v, want 300", got)
	}
}

func TestUsageRecorderByOrgRoundTripsThroughRollup(t *testing.T) {
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
	r.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricUsage))
	r.RecordRequest("openai", "gpt-4o", "iw:a", "u1", "org-1", 100, 50)
	r.FlushRollup()

	fresh := NewRecorder()
	fresh.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricUsage))
	day := time.Now().UTC().Format("2006-01-02")
	snap := map[string]interface{}{}
	fresh.MergeToday(adminrollup.MetricUsage, day, snap, usageRollupCaps)

	byOrg := adminrollup.DimMapFromSnap(snap["by_org"])
	if got := byOrg["org-1"]["tokens"]; got != 150 {
		t.Fatalf("fleet org-1 tokens = %v, want 150", got)
	}
}
