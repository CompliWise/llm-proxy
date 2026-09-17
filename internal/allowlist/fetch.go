package allowlist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// headerAdminSecret is the shared portal admin secret header. The proxy both
// validates this inbound (see internal/admin) and, here, sends the SAME secret
// value outbound so the CompliWise api authenticates the allow-list fetch.
const headerAdminSecret = "X-AI-Gateway-Admin-Secret"

const defaultFetchTimeout = 4 * time.Second

// fetcher performs the outbound GET to the CompliWise api for one org's
// allow-list. It is safe for concurrent use (http.Client is).
type fetcher struct {
	baseURL     string
	adminSecret string
	client      *http.Client
}

func newFetcher(baseURL, adminSecret string, timeout time.Duration) *fetcher {
	if timeout <= 0 {
		timeout = defaultFetchTimeout
	}
	return &fetcher{
		baseURL:     strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		adminSecret: adminSecret,
		client:      &http.Client{Timeout: timeout},
	}
}

// apiPathPrefix is the CompliWise api mount prefix. api_base_url is the origin
// only (e.g. https://api.compliwise.io); the versioned prefix is appended here.
const apiPathPrefix = "/api/v1"

// allowlistResponse mirrors the api contract:
//
//	{ "organizationId": "<id>", "models": ["gpt-4o", "gpt-4o-mini", ...] }
//
// models already includes both aliases and raw model ids. An empty array means
// "no restriction".
type allowlistResponse struct {
	OrganizationID string   `json:"organizationId"`
	Models         []string `json:"models"`
}

// Fetch retrieves the allow-list for orgID. A non-2xx response, transport error,
// or decode failure returns an error so the caller can fail open. A successful
// response with no models returns an empty (non-nil) slice.
func (f *fetcher) Fetch(ctx context.Context, orgID string) ([]string, error) {
	if f.baseURL == "" {
		return nil, errors.New("allowlist: api base url not configured")
	}
	endpoint := f.baseURL + apiPathPrefix + "/ai-gateway/org/" + url.PathEscape(orgID) + "/model-allowlist"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set(headerAdminSecret, f.adminSecret)
	req.Header.Set("Accept", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("allowlist fetch: status %d: %s", resp.StatusCode, truncate(raw, 200))
	}

	var parsed allowlistResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("allowlist fetch: decode: %w", err)
	}
	if parsed.Models == nil {
		return []string{}, nil
	}
	return parsed.Models, nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n])
}
