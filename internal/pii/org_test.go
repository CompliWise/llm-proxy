package pii

import (
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/alicebob/miniredis/v2"
)

func TestPIIRecorderAggregatesByOrg_NoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordRedaction("openai", "iw:a", "org-1", map[string]int{"EMAIL_ADDRESS": 1}, 100, time.Millisecond, OutcomeOK)
	r.RecordRedaction("openai", "iw:b", "org-2", map[string]int{"EMAIL_ADDRESS": 2}, 100, time.Millisecond, OutcomeOK)
	r.RecordRedaction("openai", "iw:b", "org-2", nil, 100, time.Millisecond, OutcomeOK)
	// org-less request must not create a by_org member.
	r.RecordRedaction("openai", "iw:c", "", nil, 100, time.Millisecond, OutcomeOK)

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
	if got := byOrg["org-1"]["requests_scanned"]; got != 1 {
		t.Fatalf("org-1 requests_scanned = %v, want 1", got)
	}
	if got := byOrg["org-1"]["requests_with_pii"]; got != 1 {
		t.Fatalf("org-1 requests_with_pii = %v, want 1", got)
	}
	if got := byOrg["org-2"]["requests_scanned"]; got != 2 {
		t.Fatalf("org-2 requests_scanned = %v, want 2 (must exclude org-1)", got)
	}
	if got := byOrg["org-2"]["requests_with_pii"]; got != 1 {
		t.Fatalf("org-2 requests_with_pii = %v, want 1", got)
	}
}

func TestPIIRecorderByOrgRoundTripsThroughRollup(t *testing.T) {
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
	r.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricPII))
	r.RecordRedaction("openai", "iw:a", "org-1", map[string]int{"EMAIL_ADDRESS": 2}, 100, time.Millisecond, OutcomeOK)
	r.FlushRollup()

	fresh := NewRecorder()
	fresh.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricPII))
	day := time.Now().UTC().Format("2006-01-02")
	snap := map[string]interface{}{}
	fresh.MergeToday(adminrollup.MetricPII, day, snap, piiRollupCaps)

	byOrg := adminrollup.DimMapFromSnap(snap["by_org"])
	if got := byOrg["org-1"]["requests_scanned"]; got != 1 {
		t.Fatalf("fleet org-1 requests_scanned = %v, want 1", got)
	}
	if got := byOrg["org-1"]["entities_total"]; got != 2 {
		t.Fatalf("fleet org-1 entities_total = %v, want 2", got)
	}
}
