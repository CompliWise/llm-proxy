package admin

import (
	"net/http"
	"reflect"
	"strings"

	"github.com/Instawork/llm-proxy/internal/adminrollup"
)

// requestOrgID returns the organization the admin monitoring request is scoped
// to, taken from the X-Organization-Id header. An empty result means the caller
// wants the global (fleet-wide) payload — the backward-compatible default.
func requestOrgID(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get(headerOrganizationID))
}

// orgScalar maps a by_org member field to the top-level snapshot scalar it
// overrides, and whether that scalar is an integer count (vs a float).
type orgScalar struct {
	field  string // by_org member field name (e.g. "spend_usd")
	outKey string // top-level snapshot key it replaces (e.g. "spend_today_usd")
	asInt  bool
}

// Per-metric mappings from a by_org member's fields to the headline snapshot
// scalars they replace when a request is org-scoped. Field names match what the
// recorders emit into the by_org dimension (and the adminrollup read path).
var (
	costOrgScalars = []orgScalar{
		{"spend_usd", "spend_today_usd", false},
		{"input_spend_usd", "input_spend_today_usd", false},
		{"output_spend_usd", "output_spend_today_usd", false},
		{"requests", "requests_today", true},
		{"input_tokens", "input_tokens_today", true},
		{"output_tokens", "output_tokens_today", true},
	}
	usageOrgScalars = []orgScalar{
		{"requests", "requests_today", true},
		{"tokens", "tokens_today", true},
	}
	piiOrgScalars = []orgScalar{
		{"requests_scanned", "requests_scanned", true},
		{"requests_with_pii", "requests_with_pii", true},
		{"entities_total", "entities_total", true},
		{"fail_open", "fail_open", true},
		{"fail_closed", "fail_closed", true},
		{"oversize", "oversize", true},
	}
	modelStatusOrgScalars = []orgScalar{
		{"retired_total", "retired_total", true},
		{"deprecated_total", "deprecated_total", true},
		{"unknown_total", "unknown_total", true},
	}
	rateLimitOrgScalars = []orgScalar{
		{"requests_total", "requests_total", true},
		{"requests_allowed", "requests_allowed", true},
		{"requests_blocked", "requests_blocked", true},
	}
)

// orgBreakdownFields are fleet-wide sub-breakdowns that are NOT decomposable per
// organization (the recorders track them fleet-wide only). In an org-scoped view
// they would expose other tenants' rows — key ids, user ids, per-request events,
// per-model counts — so they are blanked to an empty value of the same type. The
// per-org headline totals (sourced from by_org[orgID]) and the narrowed by_org
// field carry the tenant's own numbers. The daily_history trend series is scoped
// per-row (each row is itself a snapshot carrying its own by_org); hourly_history
// carries only fleet scalars with no by_org to attribute, so it is dropped from
// org views entirely.
var orgBreakdownFields = []string{
	"by_key", "by_provider", "by_user", "by_model", "by_entity", "by_reason",
	"by_retired", "by_deprecated", "by_unknown",
	"counters",
	"recent", "recent_events", "recent_blocks",
	"top_models", "top_providers", "top_keys",
}

// emptySameType returns an empty value of v's concrete type when v is a slice or
// map (so JSON renders "[]" / "{}" and the field keeps its shape), else v
// unchanged. It never mutates v.
func emptySameType(v interface{}) interface{} {
	if v == nil {
		return v
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		return reflect.MakeSlice(reflect.SliceOf(rv.Type().Elem()), 0, 0).Interface()
	case reflect.Map:
		return reflect.MakeMap(rv.Type()).Interface()
	default:
		return v
	}
}

// orgScopeStats returns a copy of a metric stats snapshot narrowed to a single
// organization: the headline scalar totals are replaced with that org's numbers
// (zero when the org has no traffic, never the global sum), by_org is narrowed to
// just that org, and every fleet-wide sub-breakdown that cannot be decomposed per
// org is blanked so an org view can never contain another tenant's data. Returns
// stats unchanged (and never mutates it) when orgID is empty or the snapshot is
// unavailable.
func orgScopeStats(stats map[string]interface{}, orgID string, mapping []orgScalar) map[string]interface{} {
	if stats == nil || orgID == "" {
		return stats
	}
	if avail, ok := stats["available"].(bool); ok && !avail {
		return stats
	}

	fields := adminrollup.DimMapFromSnap(stats["by_org"])[orgID]
	if fields == nil {
		fields = map[string]float64{}
	}

	out := make(map[string]interface{}, len(stats))
	for k, v := range stats {
		out[k] = v
	}
	for _, m := range mapping {
		v := fields[m.field]
		if m.asInt {
			out[m.outKey] = int64(v)
		} else {
			out[m.outKey] = v
		}
	}
	// Blank fleet-wide breakdowns so the tenant view never leaks other orgs'
	// rows. Only touch keys that exist, preserving each field's JSON shape.
	for _, field := range orgBreakdownFields {
		if v, ok := out[field]; ok {
			out[field] = emptySameType(v)
		}
	}
	// daily_history rows are themselves per-day snapshots (each carries its own
	// by_org + nested breakdowns), so scope every row the same way as the top
	// level: the tenant sees its OWN daily trend, never another org's per-day
	// totals, keys, or users.
	if dh, ok := out["daily_history"]; ok {
		out["daily_history"] = scopeHistoryRows(dh, orgID, mapping)
	}
	// hourly_history rows carry only fleet scalars (no by_org to attribute), so
	// drop the series in org views rather than leak/mislead. Per-org hourly is a
	// future enhancement.
	if hh, ok := out["hourly_history"]; ok {
		out["hourly_history"] = emptySameType(hh)
	}
	out["by_org"] = map[string]map[string]float64{orgID: fields}
	return out
}

// scopeHistoryRows scopes a daily_history slice to one org, returning a NEW
// slice of NEW row maps (never mutating the input). Each row is a per-day
// snapshot, so it is narrowed exactly like the top level: headline scalars
// recomputed from row["by_org"][orgID] (zero when the org has no entry that
// day), by_org narrowed to that org, and every other sub-breakdown blanked.
func scopeHistoryRows(raw interface{}, orgID string, mapping []orgScalar) interface{} {
	switch rows := raw.(type) {
	case []map[string]interface{}:
		out := make([]map[string]interface{}, len(rows))
		for i, row := range rows {
			out[i] = scopeHistoryRow(row, orgID, mapping)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(rows))
		for i, r := range rows {
			if row, ok := r.(map[string]interface{}); ok {
				out[i] = scopeHistoryRow(row, orgID, mapping)
			} else {
				out[i] = r
			}
		}
		return out
	default:
		return raw
	}
}

func scopeHistoryRow(row map[string]interface{}, orgID string, mapping []orgScalar) map[string]interface{} {
	fields := adminrollup.DimMapFromSnap(row["by_org"])[orgID]
	if fields == nil {
		fields = map[string]float64{}
	}
	out := make(map[string]interface{}, len(row))
	for k, v := range row {
		out[k] = v
	}
	for _, m := range mapping {
		v := fields[m.field]
		if m.asInt {
			out[m.outKey] = int64(v)
		} else {
			out[m.outKey] = v
		}
	}
	for _, field := range orgBreakdownFields {
		if v, ok := out[field]; ok {
			out[field] = emptySameType(v)
		}
	}
	out["by_org"] = map[string]map[string]float64{orgID: fields}
	return out
}

// orgScopePII org-scopes the PII stats snapshot and recomputes detection_rate
// from the org's own scanned/with-PII/fail counters (a plain scalar overlay
// would otherwise leave the fleet-wide rate in place).
func orgScopePII(stats map[string]interface{}, orgID string) map[string]interface{} {
	if stats == nil || orgID == "" {
		return stats
	}
	if avail, ok := stats["available"].(bool); ok && !avail {
		return stats
	}
	out := orgScopeStats(stats, orgID, piiOrgScalars)
	out["detection_rate"] = piiRowDetectionRate(out)
	// detection_rate is derived (not a by_org member), so recompute it for each
	// per-day history row from that row's now-org-scoped counters.
	if rows, ok := out["daily_history"].([]map[string]interface{}); ok {
		for _, row := range rows {
			row["detection_rate"] = piiRowDetectionRate(row)
		}
	}
	return out
}

func piiRowDetectionRate(row map[string]interface{}) float64 {
	return adminrollup.PIIDetectionRate(
		adminrollup.SnapInt64(row["requests_scanned"]),
		adminrollup.SnapInt64(row["requests_with_pii"]),
		adminrollup.SnapInt64(row["fail_open"]),
		adminrollup.SnapInt64(row["fail_closed"]),
		adminrollup.SnapInt64(row["oversize"]),
	)
}
