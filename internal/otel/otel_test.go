package otel

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJoinSignalURLHTTP(t *testing.T) {
	t.Parallel()
	require.Equal(t, "http://collector:4318/v1/traces", joinSignalURL("http://collector:4318", "traces", "", "otlp_proto_http"))
	require.Equal(t, "http://collector:4318/v1/traces", joinSignalURL("http://collector:4318/v1/traces", "traces", "", "otlp_proto_http"))
	require.Equal(t, "", joinSignalURL("http://collector:4318", "traces", "", "none"))
}

func TestJoinSignalURLGRPC(t *testing.T) {
	t.Parallel()
	require.Equal(t, "collector:4317", joinSignalURL("collector:4317/v1/traces", "traces", "", "otlp_proto_grpc"))
}

func TestParseExportType(t *testing.T) {
	t.Parallel()
	require.Equal(t, "statsig", parseExportType("statsig"))
	require.Equal(t, "otlp", parseExportType(""))
	require.Equal(t, "otlp", parseExportType("OTLP"))
}

func TestInitializeWithoutEndpointIsNoop(t *testing.T) {
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_EXPORT_TYPE", "otlp")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("STATSIG_SERVER_KEY", "")
	Initialize(nil, "llm-proxy-test")
	require.False(t, Enabled())
	Shutdown(context.Background())
}
