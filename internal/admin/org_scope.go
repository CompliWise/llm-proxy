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
		{"denied_total", "denied_total", true},
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
	"by_retired", "by_deprecated", "by_unknown", "by_denied",
	"counters",
	// recent_events are circuit/provider infrastructure events (circuitstats),
	// not tenant traffic — they carry no org_id, so they stay blanked in an org
	// view. The per-request "recent" and "recent_blocks" feeds DO carry an
	// org_id per row (KAN-277) and are org-scoped (not blanked) below.
	"recent_events",
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
	// The per-request "recent" waterfall and "recent_blocks" feed carry an
	// org_id per row (KAN-277), so narrow them to the requesting tenant instead
	// of blanking: an org admin sees ONLY its own requests, never another
	// tenant's row and never an un-attributed (blank-org) one. These rows carry
	// key_id / user_id, so this is the cross-tenant-isolation boundary.
	for _, field := range []string{"recent", "recent_blocks"} {
		if v, ok := out[field]; ok {
			out[field] = scopeRecentRows(v, orgID)
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
	// Defense-in-depth: recent/recent_blocks are no longer in orgBreakdownFields
	// (they're org-FILTERED at the top level, not blanked). Daily-history rows are
	// aggregate day snapshots that never carry a per-request feed today, but if one
	// ever did, blank it here so a trend row can't silently leak another org's
	// requests.
	for _, field := range []string{"recent", "recent_blocks"} {
		if v, ok := out[field]; ok {
			out[field] = emptySameType(v)
		}
	}
	out["by_org"] = map[string]map[string]float64{orgID: fields}
	return out
}

// scopeRecentRows narrows a per-request "recent"-style event slice (the cost
// waterfall, the rate-limit "recent_blocks" feed, the PII / ID-gate recent
// feeds) to a single organization: it returns a NEW slice of the SAME element
// type containing only rows whose org_id equals orgID, and never mutates the
// input. Rows with a blank or missing org_id are EXCLUDED — an un-attributed
// row must never leak into a specific tenant's view. These rows carry
// key_id / user_id, so this is the cross-tenant-isolation boundary for the
// per-request feeds (KAN-277). Non-slice values (and an empty orgID) are
// returned unchanged.
//
// The slice is a concrete, per-package typed slice in the live snapshot (e.g.
// []coststats.recentEntry, whose element type is unexported), so rows are read
// generically via reflection by their "org_id" JSON tag; the []map[string]
// interface{} form produced by the rollup read path is handled too.
func scopeRecentRows(v any, orgID string) any {
	if v == nil || orgID == "" {
		return v
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return v
	}
	out := reflect.MakeSlice(reflect.SliceOf(rv.Type().Elem()), 0, 0)
	for i := 0; i < rv.Len(); i++ {
		if rowOrgID(rv.Index(i)) == orgID {
			out = reflect.Append(out, rv.Index(i))
		}
	}
	return out.Interface()
}

// rowOrgID extracts the org_id from one recent-event row, whether the row is a
// typed struct (read by its "org_id" JSON tag) or a map[string]interface{}
// (the rollup-merged form, keyed "org_id"). interface{} / pointer elements are
// unwrapped. Returns "" when absent.
func rowOrgID(elem reflect.Value) string {
	for elem.Kind() == reflect.Interface || elem.Kind() == reflect.Ptr {
		if elem.IsNil() {
			return ""
		}
		elem = elem.Elem()
	}
	switch elem.Kind() {
	case reflect.Map:
		mv := elem.MapIndex(reflect.ValueOf("org_id"))
		if mv.IsValid() {
			if s, ok := mv.Interface().(string); ok {
				return s
			}
		}
		return ""
	case reflect.Struct:
		t := elem.Type()
		for i := 0; i < t.NumField(); i++ {
			name := t.Field(i).Tag.Get("json")
			if comma := strings.Index(name, ","); comma >= 0 {
				name = name[:comma]
			}
			if name == "org_id" {
				if f := elem.Field(i); f.Kind() == reflect.String {
					return f.String()
				}
				return ""
			}
		}
		return ""
	default:
		return ""
	}
}

// orgScopeIDGate narrows the ID-gate summary's per-request "recent" feed to a
// single organization (KAN-277) and returns a NEW map (the fleet/non-org view
// is never mutated). The ID-gate recorder tracks only fleet-wide aggregates (no
// by_org), so the scalar totals stay fleet-wide, but the identifier-bearing
// breakdowns (top_keys/by_provider/by_entity) are BLANKED — top_keys would
// otherwise expose OTHER tenants' masked key ids — and the recent rows are
// org-filtered. Returns stats unchanged when orgID is empty or unavailable.
func orgScopeIDGate(stats map[string]interface{}, orgID string) map[string]interface{} {
	if stats == nil || orgID == "" {
		return stats
	}
	if avail, ok := stats["available"].(bool); ok && !avail {
		return stats
	}
	out := make(map[string]interface{}, len(stats))
	for k, v := range stats {
		out[k] = v
	}
	if v, ok := out["recent"]; ok {
		out["recent"] = scopeRecentRows(v, orgID)
	}
	// The ID-gate recorder has no by_org dimension, so its fleet-wide breakdowns
	// carry OTHER tenants' detail. Blank the identifier-bearing ones (top_keys is
	// other orgs' masked key ids; by_provider/by_entity are their activity) so an
	// org view can't see another tenant — mirroring orgBreakdownFields for every
	// other metric. Scalar totals stay fleet-wide pending a proper idgate by_org.
	for _, field := range []string{"top_keys", "by_provider", "by_entity"} {
		if v, ok := out[field]; ok {
			out[field] = emptySameType(v)
		}
	}
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
