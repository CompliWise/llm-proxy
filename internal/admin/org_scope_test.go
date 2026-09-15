package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/Instawork/llm-proxy/internal/coststats"
	"github.com/Instawork/llm-proxy/internal/modelstatusstats"
	"github.com/Instawork/llm-proxy/internal/pii"
	"github.com/Instawork/llm-proxy/internal/ratelimitstats"
	"github.com/Instawork/llm-proxy/internal/usagestats"
	"github.com/alicebob/miniredis/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func decodeInto(rec *httptest.ResponseRecorder, v interface{}) error {
	return json.NewDecoder(rec.Body).Decode(v)
}

// testOrgScopedHandler wires recorders carrying two organizations' traffic so
// the admin monitoring handlers can be exercised with and without the
// X-Organization-Id header. org-1 is deliberately smaller than org-2 so an
// org-scoped response is provably not the global sum.
func testOrgScopedHandler(t *testing.T) (*handler, *coststats.Recorder) {
	t.Helper()
	h, _ := testAdminHandler(t)

	costRec := coststats.NewRecorder()
	usageRec := usagestats.NewRecorder()
	piiRec := pii.NewRecorder()
	modelRec := modelstatusstats.NewRecorder()
	rlRec := ratelimitstats.NewRecorder()

	// org-1 traffic.
	costRec.RecordRequest("openai", "iw:a", "u1", "gpt-4o", "org-1", 1.0, 0.6, 0.4, 100, 50)
	usageRec.RecordRequest("openai", "gpt-4o", "iw:a", "u1", "org-1", 100, 50)
	piiRec.RecordRedaction("openai", "iw:a", "org-1", map[string]int{"EMAIL_ADDRESS": 1}, 10, time.Millisecond, pii.OutcomeOK)
	modelRec.RecordRetired("openai", "o1-mini", "org-1")
	rlRec.RecordDecision("openai", "gpt-4o", "iw:a", "u1", "org-1", true, "", "", "", "", 0, 0)

	// org-2 traffic (larger).
	costRec.RecordRequest("openai", "iw:b", "u2", "gpt-4o", "org-2", 5.0, 3.0, 2.0, 500, 250)
	usageRec.RecordRequest("openai", "gpt-4o", "iw:b", "u2", "org-2", 500, 250)
	piiRec.RecordRedaction("openai", "iw:b", "org-2", map[string]int{"EMAIL_ADDRESS": 3}, 10, time.Millisecond, pii.OutcomeOK)
	piiRec.RecordRedaction("openai", "iw:b", "org-2", nil, 10, time.Millisecond, pii.OutcomeOK)
	modelRec.RecordRetired("openai", "o1-mini", "org-2")
	modelRec.RecordUnknown("openai", "typo", "org-2")
	rlRec.RecordDecision("openai", "gpt-4o", "iw:b", "u2", "org-2", false, "rpm", "requests", "minute", "k", 1, 0)

	h.deps.YAMLConfig.Features.PIIRedact.Enabled = true
	h.deps.CostSummary = costRec.Snapshot
	h.deps.UsageSummary = usageRec.Snapshot
	h.deps.PIISummary = piiRec.Snapshot
	h.deps.ModelStatusSummary = modelRec.Snapshot
	h.deps.RateLimitSummary = rlRec.Snapshot
	return h, costRec
}

func statsFromResponse(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	require.Equal(t, http.StatusOK, rec.Code)
	body := decodeJSONBody(t, rec)
	stats, ok := body["stats"].(map[string]interface{})
	require.True(t, ok, "stats missing: %v", body)
	return stats
}

func orgReq(t *testing.T, h *handler, path, orgID string) *http.Request {
	t.Helper()
	req := authenticatedRequest(t, h, http.MethodGet, path, nil)
	if orgID != "" {
		req.Header.Set(headerOrganizationID, orgID)
	}
	return req
}

// fieldLen returns the element count of a decoded JSON array/object field, or -1
// when the field is absent from the snapshot.
func fieldLen(stats map[string]interface{}, field string) int {
	v, ok := stats[field]
	if !ok {
		return -1
	}
	switch x := v.(type) {
	case []interface{}:
		return len(x)
	case map[string]interface{}:
		return len(x)
	case nil:
		return 0
	default:
		return -1
	}
}

// assertBreakdownsEmpty asserts each named fleet-wide breakdown that exists in an
// org-scoped snapshot is empty (never leaks another tenant's rows).
func assertBreakdownsEmpty(t *testing.T, stats map[string]interface{}, fields ...string) {
	t.Helper()
	for _, f := range fields {
		if n := fieldLen(stats, f); n > 0 {
			t.Fatalf("org-scoped %q must be empty, got %d entries (cross-tenant leak)", f, n)
		}
	}
}

func TestHandleCost_OrgScoped(t *testing.T) {
	h, _ := testOrgScopedHandler(t)

	// No header -> global sum (org-1 + org-2 = 6.0), breakdowns populated.
	rec := httptest.NewRecorder()
	h.handleCost(rec, orgReq(t, h, "/admin/api/cost", ""))
	global := statsFromResponse(t, rec)
	assert.Equal(t, 6.0, global["spend_today_usd"])
	assert.Equal(t, 2, fieldLen(global, "by_key"), "global by_key should list both keys")
	assert.Greater(t, fieldLen(global, "recent"), 0, "global recent should be populated")

	// org-1 header -> org-1's slice only, with NO other-tenant breakdown rows.
	rec = httptest.NewRecorder()
	h.handleCost(rec, orgReq(t, h, "/admin/api/cost", "org-1"))
	stats := statsFromResponse(t, rec)
	assert.Equal(t, 1.0, stats["spend_today_usd"])
	assert.Equal(t, float64(100), stats["input_tokens_today"])
	assert.Equal(t, float64(1), stats["requests_today"])
	assertBreakdownsEmpty(t, stats, "by_key", "by_provider", "by_user", "recent")

	// A different org sees its own numbers, still no cross-tenant rows.
	rec = httptest.NewRecorder()
	h.handleCost(rec, orgReq(t, h, "/admin/api/cost", "org-2"))
	stats = statsFromResponse(t, rec)
	assert.Equal(t, 5.0, stats["spend_today_usd"])
	assertBreakdownsEmpty(t, stats, "by_key", "by_provider", "by_user", "recent")

	// An org with no traffic sees zero, never the global sum.
	rec = httptest.NewRecorder()
	h.handleCost(rec, orgReq(t, h, "/admin/api/cost", "org-none"))
	stats = statsFromResponse(t, rec)
	assert.Equal(t, 0.0, stats["spend_today_usd"])
	assertBreakdownsEmpty(t, stats, "by_key", "by_provider", "by_user", "recent")
}

func TestHandleUsage_OrgScoped(t *testing.T) {
	h, _ := testOrgScopedHandler(t)

	rec := httptest.NewRecorder()
	h.handleUsage(rec, orgReq(t, h, "/admin/api/usage", ""))
	global := statsFromResponse(t, rec)
	assert.Equal(t, float64(2), global["requests_today"])
	assert.Greater(t, fieldLen(global, "counters"), 0, "global counters should be populated")

	rec = httptest.NewRecorder()
	h.handleUsage(rec, orgReq(t, h, "/admin/api/usage", "org-1"))
	stats := statsFromResponse(t, rec)
	assert.Equal(t, float64(1), stats["requests_today"])
	assert.Equal(t, float64(150), stats["tokens_today"])
	assertBreakdownsEmpty(t, stats, "counters", "top_models", "top_providers")
}

func TestHandlePII_OrgScoped(t *testing.T) {
	h, _ := testOrgScopedHandler(t)

	rec := httptest.NewRecorder()
	h.handlePII(rec, orgReq(t, h, "/admin/api/pii", ""))
	global := statsFromResponse(t, rec)
	assert.Equal(t, float64(3), global["requests_scanned"])
	assert.Greater(t, fieldLen(global, "by_provider"), 0, "global by_provider should be populated")
	assert.Greater(t, fieldLen(global, "recent"), 0, "global recent should be populated")

	rec = httptest.NewRecorder()
	h.handlePII(rec, orgReq(t, h, "/admin/api/pii", "org-2"))
	stats := statsFromResponse(t, rec)
	assert.Equal(t, float64(2), stats["requests_scanned"])
	assert.Equal(t, float64(1), stats["requests_with_pii"])
	// detection_rate recomputed from org-2's own counters (1 with PII / 2 clean).
	assert.Equal(t, 0.5, stats["detection_rate"])
	assertBreakdownsEmpty(t, stats, "by_entity", "by_provider", "top_keys", "recent")
}

func TestHandleModelStatus_OrgScoped(t *testing.T) {
	h, _ := testOrgScopedHandler(t)

	rec := httptest.NewRecorder()
	h.handleModelStatus(rec, orgReq(t, h, "/admin/api/model-status", ""))
	global := statsFromResponse(t, rec)
	assert.Equal(t, float64(2), global["retired_total"])
	assert.Greater(t, fieldLen(global, "by_retired"), 0, "global by_retired should be populated")

	rec = httptest.NewRecorder()
	h.handleModelStatus(rec, orgReq(t, h, "/admin/api/model-status", "org-1"))
	stats := statsFromResponse(t, rec)
	assert.Equal(t, float64(1), stats["retired_total"])
	assert.Equal(t, float64(0), stats["unknown_total"])
	assertBreakdownsEmpty(t, stats, "by_retired", "by_deprecated", "by_unknown")
}

func TestHandleRateLimits_OrgScoped(t *testing.T) {
	h, _ := testOrgScopedHandler(t)

	// No header -> global (2 total decisions), breakdowns populated.
	rec := httptest.NewRecorder()
	h.handleRateLimits(rec, orgReq(t, h, "/admin/api/rate-limits", ""))
	body := decodeJSONBody(t, rec)
	globalStats, ok := body["stats"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(2), globalStats["requests_total"])
	assert.Greater(t, fieldLen(globalStats, "by_provider"), 0, "global by_provider should be populated")
	assert.Greater(t, fieldLen(globalStats, "recent_blocks"), 0, "global recent_blocks should be populated")

	// org-2 header -> org-2's slice (1 total, 1 blocked), no cross-tenant rows.
	rec = httptest.NewRecorder()
	h.handleRateLimits(rec, orgReq(t, h, "/admin/api/rate-limits", "org-2"))
	body = decodeJSONBody(t, rec)
	stats, ok := body["stats"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(1), stats["requests_total"])
	assert.Equal(t, float64(1), stats["requests_blocked"])
	assertBreakdownsEmpty(t, stats, "by_provider", "by_reason", "recent_blocks")
}

func TestHandleListKeys_OrgScoped(t *testing.T) {
	h, store := testAdminHandler(t)
	ctx := context.Background()

	_, err := store.CreateKey(ctx, "openai", "sk-1", "org-1 key", 0, map[string]string{"organization_id": "org-1"}, nil)
	require.NoError(t, err)
	_, err = store.CreateKey(ctx, "anthropic", "sk-2", "org-2 key", 0, map[string]string{"organization_id": "org-2"}, nil)
	require.NoError(t, err)
	_, err = store.CreateKey(ctx, "openai", "sk-3", "legacy key", 0, nil, nil)
	require.NoError(t, err)

	// No header -> all three keys.
	rec := httptest.NewRecorder()
	h.handleListKeys(rec, orgReq(t, h, "/admin/api/keys", ""))
	require.Equal(t, http.StatusOK, rec.Code)
	var all []map[string]interface{}
	require.NoError(t, decodeInto(rec, &all))
	require.Len(t, all, 3)

	// org-1 header -> only the org-1 key.
	rec = httptest.NewRecorder()
	h.handleListKeys(rec, orgReq(t, h, "/admin/api/keys", "org-1"))
	require.Equal(t, http.StatusOK, rec.Code)
	var scoped []map[string]interface{}
	require.NoError(t, decodeInto(rec, &scoped))
	require.Len(t, scoped, 1)
	assert.Equal(t, "org-1 key", scoped[0]["description"])
}

// flushable is satisfied by every metric recorder (via the embedded
// adminrollup.RecorderBinding) and lets the bound test force pending deltas into
// Redis synchronously.
type flushable interface{ FlushRollup() }

// testOrgScopedHandlerBound wires the five monitoring recorders to a shared
// miniredis rollup store so daily_history / hourly_history are actually
// populated (they are no-ops for unbound recorders). org-1 traffic is smaller
// than org-2 so an org-scoped per-day total is provably not the fleet sum.
func testOrgScopedHandlerBound(t *testing.T) *handler {
	t.Helper()
	h, _ := testAdminHandler(t)

	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	store, err := adminrollup.NewStore(adminrollup.Config{
		Enabled: true,
		Redis:   &config.RedisConfig{Address: mr.Addr(), DB: 6, DBSet: true},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	costRec := coststats.NewRecorder()
	costRec.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricCost))
	usageRec := usagestats.NewRecorder()
	usageRec.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricUsage))
	piiRec := pii.NewRecorder()
	piiRec.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricPII))
	modelRec := modelstatusstats.NewRecorder()
	modelRec.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricModelStatus))
	rlRec := ratelimitstats.NewRecorder()
	rlRec.BindRollup(store, adminrollup.NewPersister(store, adminrollup.MetricRateLimit))

	// org-1 (small).
	costRec.RecordRequest("openai", "iw:a", "u1", "gpt-4o", "org-1", 1.0, 0.6, 0.4, 100, 50)
	usageRec.RecordRequest("openai", "gpt-4o", "iw:a", "u1", "org-1", 100, 50)
	piiRec.RecordRedaction("openai", "iw:a", "org-1", map[string]int{"EMAIL_ADDRESS": 1}, 10, time.Millisecond, pii.OutcomeOK)
	modelRec.RecordRetired("openai", "o1-mini", "org-1")
	rlRec.RecordDecision("openai", "gpt-4o", "iw:a", "u1", "org-1", true, "", "", "", "", 0, 0)

	// org-2 (large).
	costRec.RecordRequest("openai", "iw:b", "u2", "gpt-4o", "org-2", 5.0, 3.0, 2.0, 500, 250)
	usageRec.RecordRequest("openai", "gpt-4o", "iw:b", "u2", "org-2", 500, 250)
	piiRec.RecordRedaction("openai", "iw:b", "org-2", map[string]int{"EMAIL_ADDRESS": 3}, 10, time.Millisecond, pii.OutcomeOK)
	piiRec.RecordRedaction("openai", "iw:b", "org-2", nil, 10, time.Millisecond, pii.OutcomeOK)
	modelRec.RecordRetired("openai", "o1-mini", "org-2")
	modelRec.RecordUnknown("openai", "typo", "org-2")
	rlRec.RecordDecision("openai", "gpt-4o", "iw:b", "u2", "org-2", false, "rpm", "requests", "minute", "k", 1, 0)

	for _, rec := range []flushable{costRec, usageRec, piiRec, modelRec, rlRec} {
		rec.FlushRollup() // force debounced deltas into Redis so history populates
	}

	h.deps.YAMLConfig.Features.PIIRedact.Enabled = true
	h.deps.CostSummary = costRec.Snapshot
	h.deps.UsageSummary = usageRec.Snapshot
	h.deps.PIISummary = piiRec.Snapshot
	h.deps.ModelStatusSummary = modelRec.Snapshot
	h.deps.RateLimitSummary = rlRec.Snapshot
	return h
}

func dailyHistoryRows(stats map[string]interface{}) []map[string]interface{} {
	raw, ok := stats["daily_history"].([]interface{})
	if !ok {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(raw))
	for _, r := range raw {
		if m, ok := r.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

func anyRowByOrgHas(rows []map[string]interface{}, org string) bool {
	for _, row := range rows {
		if bo, ok := row["by_org"].(map[string]interface{}); ok {
			if _, has := bo[org]; has {
				return true
			}
		}
	}
	return false
}

func toFloat(v interface{}) float64 {
	f, _ := v.(float64)
	return f
}

// TestHandlers_OrgScopedHistoryNoLeak is the store-bound regression for the
// daily_history / hourly_history cross-tenant leak: with a rollup store bound so
// history is populated, an org-scoped response must carry per-org per-day totals
// with NO other tenant's data nested in any daily_history row, and no hourly
// series at all.
func TestHandlers_OrgScopedHistoryNoLeak(t *testing.T) {
	h := testOrgScopedHandlerBound(t)

	cases := []struct {
		name         string
		path         string
		handler      func(http.ResponseWriter, *http.Request)
		scalarKey    string
		orgScalar    float64
		globalScalar float64
		emptyFields  []string
	}{
		{"cost", "/admin/api/cost", h.handleCost, "spend_today_usd", 1.0, 6.0, []string{"by_key", "by_user", "by_provider"}},
		{"usage", "/admin/api/usage", h.handleUsage, "requests_today", 1, 2, []string{"by_model", "by_provider", "by_key", "by_user"}},
		{"pii", "/admin/api/pii", h.handlePII, "requests_scanned", 1, 3, []string{"by_entity", "by_provider", "top_keys"}},
		{"model-status", "/admin/api/model-status", h.handleModelStatus, "retired_total", 1, 2, []string{"by_retired", "by_deprecated", "by_unknown"}},
		{"rate-limits", "/admin/api/rate-limits", h.handleRateLimits, "requests_total", 1, 2, []string{"by_provider", "by_reason"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Global (no header): history populated and still carries org-2.
			rec := httptest.NewRecorder()
			tc.handler(rec, orgReq(t, h, tc.path, ""))
			gstats := statsFromResponse(t, rec)
			grows := dailyHistoryRows(gstats)
			require.NotEmpty(t, grows, "global daily_history must be populated (store bound)")
			require.True(t, anyRowByOrgHas(grows, "org-2"), "global daily_history must retain org-2")
			assert.Equal(t, tc.globalScalar, toFloat(grows[0][tc.scalarKey]), "global per-day scalar must be the fleet sum")

			// org-1 header: every daily_history row scoped to org-1 alone.
			rec = httptest.NewRecorder()
			tc.handler(rec, orgReq(t, h, tc.path, "org-1"))
			stats := statsFromResponse(t, rec)
			rows := dailyHistoryRows(stats)
			require.NotEmpty(t, rows, "org daily_history must be populated")
			assert.False(t, anyRowByOrgHas(rows, "org-2"), "daily_history leaked org-2 in a row's by_org")
			for _, row := range rows {
				byOrg, _ := row["by_org"].(map[string]interface{})
				for k := range byOrg {
					assert.Equal(t, "org-1", k, "unexpected org in daily_history row by_org")
				}
				for _, f := range tc.emptyFields {
					if n := fieldLen(row, f); n > 0 {
						t.Fatalf("daily_history row %q has %d entries in org view (cross-tenant leak)", f, n)
					}
				}
				assert.Equal(t, tc.orgScalar, toFloat(row[tc.scalarKey]),
					"per-day scalar must equal org-1's own total, not the fleet sum")
			}

			// hourly_history is dropped entirely in org views.
			assert.Equal(t, 0, fieldLen(stats, "hourly_history"), "hourly_history must be empty in org view")
		})
	}
}
