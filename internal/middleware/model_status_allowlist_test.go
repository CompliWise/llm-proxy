package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Instawork/llm-proxy/internal/apikeys"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/Instawork/llm-proxy/internal/modelstatusstats"
	"github.com/Instawork/llm-proxy/internal/providers"
)

// fakeResolver is a canned allowlist.Resolver for enforcement tests.
type fakeResolver struct {
	models []string
	found  bool
	err    error
	calls  int
}

func (f *fakeResolver) Allowlist(_ context.Context, _ string) ([]string, bool, error) {
	f.calls++
	return f.models, f.found, f.err
}

type allowlistCase struct {
	name     string
	enabled  bool
	resolver *fakeResolver
	withOrg  bool
	model    string
}

func runAllowlist(t *testing.T, tc allowlistCase) (*httptest.ResponseRecorder, *modelstatusstats.Recorder, bool) {
	t.Helper()
	pm := providers.NewProviderManager()
	pm.RegisterProvider(providers.NewOpenAIProxy())

	cfg := &config.YAMLConfig{}
	cfg.Features.ModelAllowlist.Enabled = tc.enabled

	recorder := modelstatusstats.NewRecorder()

	called := false
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { called = true })

	// A typed-nil resolver arg when the case supplies none.
	chain := ModelStatusMiddleware(pm, cfg, recorder, nil, resolverArg(tc.resolver))(next)

	body := `{"model":"` + tc.model + `","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/openai/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if tc.withOrg {
		req = req.WithContext(apikeys.WithContext(req.Context(), &apikeys.APIKey{OrgID: "org-1"}))
	}
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)
	return rec, recorder, called
}

// resolverArg converts a possibly-nil *fakeResolver into the interface arg,
// preserving an untyped nil (so the middleware's `resolver != nil` guard holds).
func resolverArg(f *fakeResolver) interface {
	Allowlist(context.Context, string) ([]string, bool, error)
} {
	if f == nil {
		return nil
	}
	return f
}

func TestAllowlist_AllowedModelForwards(t *testing.T) {
	rec, recorder, called := runAllowlist(t, allowlistCase{
		name: "allowed", enabled: true, withOrg: true, model: "gpt-4o",
		resolver: &fakeResolver{models: []string{"gpt-4o", "gpt-4o-mini"}, found: true},
	})
	if !called {
		t.Fatal("allowed model must be forwarded")
	}
	if rec.Code == http.StatusForbidden {
		t.Fatalf("allowed model must not 403 (code=%d)", rec.Code)
	}
	if got := deniedForOrg(recorder, "org-1"); got != 0 {
		t.Fatalf("no denial expected, got %v", got)
	}
}

func TestAllowlist_OffListModelIs403AndCounted(t *testing.T) {
	rec, recorder, called := runAllowlist(t, allowlistCase{
		name: "denied", enabled: true, withOrg: true, model: "gpt-4o",
		resolver: &fakeResolver{models: []string{"gpt-4o-mini"}, found: true},
	})
	if called {
		t.Fatal("off-list model must NOT be forwarded")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403", rec.Code)
	}
	if got := rec.Header().Get(providers.HeaderModelRetired); got != "model_not_allowed" {
		t.Fatalf("error-class header=%q, want model_not_allowed", got)
	}
	if got := deniedForOrg(recorder, "org-1"); got != 1 {
		t.Fatalf("org-1 denied_total=%v, want 1", got)
	}
}

// Every fail-open path forwards and records no denial.
func TestAllowlist_FailOpenPaths(t *testing.T) {
	cases := []allowlistCase{
		{name: "nil resolver", enabled: true, withOrg: true, model: "gpt-4o", resolver: nil},
		{name: "feature disabled", enabled: false, withOrg: true, model: "gpt-4o",
			resolver: &fakeResolver{models: []string{"other"}, found: true}},
		{name: "no org", enabled: true, withOrg: false, model: "gpt-4o",
			resolver: &fakeResolver{models: []string{"other"}, found: true}},
		{name: "empty list", enabled: true, withOrg: true, model: "gpt-4o",
			resolver: &fakeResolver{models: []string{}, found: true}},
		{name: "not found", enabled: true, withOrg: true, model: "gpt-4o",
			resolver: &fakeResolver{models: nil, found: false}},
		{name: "resolver error", enabled: true, withOrg: true, model: "gpt-4o",
			resolver: &fakeResolver{err: context.DeadlineExceeded}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec, recorder, called := runAllowlist(t, tc)
			if !called {
				t.Fatalf("%s: request must be forwarded (fail open)", tc.name)
			}
			if rec.Code == http.StatusForbidden {
				t.Fatalf("%s: must not 403", tc.name)
			}
			if got := deniedForOrg(recorder, "org-1"); got != 0 {
				t.Fatalf("%s: no denial expected, got %v", tc.name, got)
			}
		})
	}
}

func deniedForOrg(r *modelstatusstats.Recorder, org string) float64 {
	snap := r.Snapshot()
	byOrg, ok := snap["by_org"].(map[string]map[string]float64)
	if !ok {
		return -1
	}
	return byOrg[org]["denied_total"]
}
