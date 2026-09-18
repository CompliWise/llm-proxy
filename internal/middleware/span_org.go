package middleware

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/Instawork/llm-proxy/internal/apikeys"
)

// SpanOrgTagMiddleware stamps the resolved organization id (and key id) onto the
// active OTel server span — the otelmux span installed at the router root — so
// per-request traces can be filtered per organization (KAN-277).
//
// It must run AFTER APIKeyValidationMiddleware so the resolved proxy-key record
// is already on the request context. Unscoped/legacy traffic (no key on the
// context) is a no-op, and it never starts a new span or tracer of its own.
func SpanOrgTagMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if rec, ok := apikeys.FromContext(r.Context()); ok && rec != nil {
				attrs := make([]attribute.KeyValue, 0, 2)
				if org := rec.OrganizationID(); org != "" {
					attrs = append(attrs, attribute.String("org_id", org))
				}
				if rec.PK != "" {
					attrs = append(attrs, attribute.String("key_id", rec.PK))
				}
				if len(attrs) > 0 {
					trace.SpanFromContext(r.Context()).SetAttributes(attrs...)
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
