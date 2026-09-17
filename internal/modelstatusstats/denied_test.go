package modelstatusstats

import "testing"

// RecordDenied (KAN-354) must behave like the other status counters: it feeds
// the top-level denied_total, the by_denied provider:model breakdown, and a
// per-org denied_total that never bleeds one tenant's denials into another.
func TestModelStatusRecorderDenied_OrgScopedNoCrossBleed(t *testing.T) {
	r := NewRecorder()
	r.RecordDenied("openai", "gpt-4o", "org-1")
	r.RecordDenied("anthropic", "claude-3-opus", "org-2")
	r.RecordDenied("anthropic", "claude-3-opus", "org-2")
	// An org-less denial must not create a by_org member.
	r.RecordDenied("openai", "gpt-4o", "")

	snap := r.Snapshot()

	if got := snap["denied_total"]; toI(got) != 4 {
		t.Fatalf("denied_total = %v, want 4", got)
	}

	byOrg, ok := snap["by_org"].(map[string]map[string]float64)
	if !ok {
		t.Fatalf("by_org type = %T", snap["by_org"])
	}
	if _, phantom := byOrg[""]; phantom {
		t.Fatal("phantom empty-org member recorded")
	}
	if got := byOrg["org-1"]["denied_total"]; got != 1 {
		t.Fatalf("org-1 denied_total = %v, want 1", got)
	}
	if got := byOrg["org-2"]["denied_total"]; got != 2 {
		t.Fatalf("org-2 denied_total = %v, want 2", got)
	}
	// org-1 must NOT see org-2's denials.
	if got := byOrg["org-1"]["denied_total"]; got != 1 {
		t.Fatalf("cross-bleed: org-1 sees %v denials", got)
	}

	// The provider:model breakdown is present in the fleet-wide snapshot.
	found := false
	for _, e := range snap["by_denied"].([]kv) {
		if e.Name == "anthropic:claude-3-opus" && e.Count == 2 {
			found = true
		}
	}
	if !found {
		t.Fatalf("by_denied missing anthropic:claude-3-opus=2: %v", snap["by_denied"])
	}
}

func toI(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	default:
		return -1
	}
}
