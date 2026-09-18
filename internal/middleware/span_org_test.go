package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/Instawork/llm-proxy/internal/apikeys"
	"github.com/stretchr/testify/require"
)

// A request whose context carries a resolved proxy key must stamp org_id and
// key_id on the active span (KAN-277).
func TestSpanOrgTagMiddleware_StampsOrgAndKey(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr))
	tracer := tp.Tracer("test")

	var handled bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handled = true })
	mw := SpanOrgTagMiddleware()(next)

	req := httptest.NewRequest(http.MethodPost, "/openai/v1/chat/completions", nil)
	ctx, span := tracer.Start(req.Context(), "server")
	ctx = apikeys.WithContext(ctx, &apikeys.APIKey{PK: "iw:key-1", OrgID: "org-1"})
	mw.ServeHTTP(httptest.NewRecorder(), req.WithContext(ctx))
	span.End()

	require.True(t, handled, "next handler must run")

	spans := sr.Ended()
	require.Len(t, spans, 1)
	attrs := map[string]string{}
	for _, kv := range spans[0].Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsString()
	}
	require.Equal(t, "org-1", attrs["org_id"])
	require.Equal(t, "iw:key-1", attrs["key_id"])
}

// No key on the context (unscoped/legacy traffic, and no active span) must not
// panic and must still run the next handler.
func TestSpanOrgTagMiddleware_NoKeyNoPanic(t *testing.T) {
	var handled bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handled = true })
	mw := SpanOrgTagMiddleware()(next)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	mw.ServeHTTP(httptest.NewRecorder(), req)

	require.True(t, handled, "next handler must run without a key")
}
