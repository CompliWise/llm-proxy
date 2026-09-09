package providers

import (
	"net/http"
	"testing"
)

// TestStripUpstreamCORS verifies the helper removes every upstream CORS response
// header (so our middleware stays the single source and browsers never see a
// duplicate Access-Control-Allow-Origin) while leaving other headers intact.
func TestStripUpstreamCORS(t *testing.T) {
	h := http.Header{}
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST")
	h.Set("Access-Control-Allow-Headers", "Authorization")
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Set("Access-Control-Expose-Headers", "X-Thing")
	h.Set("Access-Control-Max-Age", "600")
	h.Set("Content-Type", "application/json") // must survive

	stripUpstreamCORS(h)

	for _, key := range []string{
		"Access-Control-Allow-Origin",
		"Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers",
		"Access-Control-Allow-Credentials",
		"Access-Control-Expose-Headers",
		"Access-Control-Max-Age",
	} {
		if got := h.Values(key); len(got) != 0 {
			t.Errorf("expected %s to be stripped, got %v", key, got)
		}
	}

	if got := h.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type must survive strip, got %q", got)
	}
}
