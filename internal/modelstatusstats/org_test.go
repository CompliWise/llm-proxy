package modelstatusstats

import (
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/alicebob/miniredis/v2"
)

func TestModelStatusRecorderAggregatesByOrg_NoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordRetired("openai", "o1-mini", "org-1")
	r.RecordRetired("openai", "o1-mini", "org-2")
	r.RecordUnknown("openai", "typo", "org-2")
	// org-less request must not create a by_org member.
	r.RecordRetired("openai", "o1-mini", "")

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
	if got := byOrg["org-1"]["retired_total"]; got != 1 {
		t.Fatalf("org-1 retired_total = %v, want 1", got)
	}
	if got := byOrg["org-2"]["retired_total"]; got != 1 {
		t.Fatalf("org-2 retired_total = %v, want 1", got)
	}
	if got := byOrg["org-2"]["unknown_total"]; got != 1 {
		t.Fatalf("org-2 unknown_total = %v, want 1", got)
	}
	if got := byOrg["org-1"]["unknown_total"]; got != 0 {
		t.Fatalf("org-1 unknown_total = %v, want 0 (must exclude org-2)", got)
	}
}

func TestModelStatusRecorderByOrgRoundTripsThroughRollup(t *testing.T) {
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
	r.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricModelStatus))
	r.RecordRetired("openai", "o1-mini", "org-1")
	r.FlushRollup()

	fresh := NewRecorder()
	fresh.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricModelStatus))
	day := time.Now().UTC().Format("2006-01-02")
	snap := map[string]interface{}{}
	fresh.MergeToday(adminrollup.MetricModelStatus, day, snap, modelStatusRollupCaps)

	byOrg := adminrollup.DimMapFromSnap(snap["by_org"])
	if got := byOrg["org-1"]["retired_total"]; got != 1 {
		t.Fatalf("fleet org-1 retired_total = %v, want 1", got)
	}
}
