package idgatestats

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// KAN-277: the ID-gate recent feed must stamp org_id per row so an org-scoped
// admin view can be narrowed to the tenant's own traffic. An org-less request
// records a blank org_id (the reader excludes those from any scoped view).
func TestRecorderRecentCarriesOrgID(t *testing.T) {
	r := NewRecorder()
	r.RecordClear("gemini", "iw:a", "org-1", 1, time.Millisecond)
	r.RecordBlocked("gemini", "iw:b", "org-2", "US_DRIVER_LICENSE", 0.9, 0, 2, time.Millisecond)
	r.RecordScanFailed("gemini", "iw:c", "", "ocr", false, 1, time.Millisecond)

	snap := r.Snapshot()
	recent, ok := snap["recent"].([]recentEntry)
	require.True(t, ok, "recent type = %T", snap["recent"])
	require.Len(t, recent, 3)

	byKey := map[string]string{}
	for _, e := range recent {
		byKey[e.KeyID] = e.OrgID
	}
	require.Equal(t, "org-1", byKey["iw:a"])
	require.Equal(t, "org-2", byKey["iw:b"])
	require.Equal(t, "", byKey["iw:c"], "org-less row must carry a blank org_id")
}
