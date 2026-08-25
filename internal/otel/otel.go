package otel

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
	"google.golang.org/grpc/credentials"
)

const (
	statsigOTLPEndpoint = "https://api.statsig.com/otlp"
	statsigOTLPHeader   = "statsig-api-key"
	serviceNamespace    = "compliwise"
)

var (
	mu              sync.Mutex
	tracerProvider  *sdktrace.TracerProvider
	meterProvider   *metric.MeterProvider
)

type resolvedConfig struct {
	enabled         bool
	exportType      string
	headers         map[string]string
	serviceName     string
	serviceVersion  string
	environment     string
	attributes      map[string]string
	certificatePath string
	tracesURL       string
	metricsURL      string
	tracesGRPC      bool
	metricsGRPC     bool
}

func readEnv(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

func parseBoolEnv(value string, defaultValue bool) bool {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return defaultValue
	}
}

func parseExportType(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "statsig") {
		return "statsig"
	}
	return "otlp"
}

func parseExporter(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "":
		return "otlp_proto_http"
	case "none":
		return "none"
	case "grpc", "otlp_proto_grpc":
		return "otlp_proto_grpc"
	default:
		return "otlp_proto_http"
	}
}

func parseKeyValueList(value string) map[string]string {
	next := map[string]string{}
	if strings.TrimSpace(value) == "" {
		return next
	}
	for _, pair := range strings.Split(value, ",") {
		trimmed := strings.TrimSpace(pair)
		if trimmed == "" {
			continue
		}
		idx := strings.Index(trimmed, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(trimmed[:idx])
		if key == "" {
			continue
		}
		next[key] = strings.TrimSpace(trimmed[idx+1:])
	}
	return next
}

func trimSlash(endpoint string) string {
	return strings.TrimRight(endpoint, "/")
}

func stripSignalPath(endpoint string) string {
	normalized := trimSlash(endpoint)
	for _, path := range []string{"/v1/traces", "/v1/metrics", "/v1/logs"} {
		if strings.HasSuffix(normalized, path) {
			return strings.TrimSuffix(normalized, path)
		}
	}
	return normalized
}

func joinSignalURL(base, signal, explicit, exporter string) string {
	if exporter == "none" {
		return ""
	}
	candidate := strings.TrimSpace(explicit)
	if candidate == "" {
		candidate = strings.TrimSpace(base)
	}
	if candidate == "" {
		return ""
	}
	normalized := trimSlash(candidate)
	if exporter == "otlp_proto_grpc" {
		return stripSignalPath(normalized)
	}
	path := "/v1/" + signal
	if strings.HasSuffix(normalized, path) {
		return normalized
	}
	return normalized + path
}

func grpcTarget(url string) string {
	stripped := strings.TrimPrefix(strings.TrimPrefix(url, "https://"), "http://")
	return stripSignalPath(stripped)
}

func resolveConfig(serviceName string) resolvedConfig {
	exportType := parseExportType(readEnv("OTEL_EXPORT_TYPE"))
	enabled := parseBoolEnv(os.Getenv("OTEL_ENABLED"), true)
	base := readEnv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if base == "" && exportType == "statsig" {
		base = statsigOTLPEndpoint
	}
	tracesExporter := parseExporter(readEnv("OTEL_TRACES_EXPORTER"))
	metricsExporter := parseExporter(readEnv("OTEL_METRICS_EXPORTER"))
	tracesURL := joinSignalURL(base, "traces", readEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"), tracesExporter)
	metricsURL := joinSignalURL(base, "metrics", readEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"), metricsExporter)

	headers := map[string]string{}
	if exportType == "statsig" {
		if key := readEnv("STATSIG_SERVER_KEY"); key != "" {
			headers[statsigOTLPHeader] = key
		}
	}
	for k, v := range parseKeyValueList(readEnv("OTEL_EXPORTER_OTLP_HEADERS")) {
		headers[k] = v
	}

	environment := readEnv("OTEL_ENVIRONMENT")
	if environment == "" {
		environment = readEnv("NODE_ENV")
	}
	if environment == "" {
		environment = readEnv("ENVIRONMENT")
	}
	if environment == "" {
		environment = "development"
	}
	version := readEnv("OTEL_SERVICE_VERSION")
	if version == "" {
		version = readEnv("VERSION")
	}
	if version == "" {
		version = "0.0.0"
	}
	name := readEnv("OTEL_SERVICE_NAME")
	if name == "" {
		name = serviceName
	}
	attrs := map[string]string{
		"appVersion":              version,
		"deployment.environment":  environment,
		"env":                     environment,
		"version":                 version,
		"service.namespace":       serviceNamespace,
	}
	for k, v := range parseKeyValueList(readEnv("OTEL_RESOURCE_ATTRIBUTES")) {
		attrs[k] = v
	}

	hasExporter := tracesURL != "" || metricsURL != ""
	statsigMissing := exportType == "statsig" && headers[statsigOTLPHeader] == ""
	canExport := hasExporter && !statsigMissing

	return resolvedConfig{
		enabled:         enabled && canExport,
		exportType:      exportType,
		headers:         headers,
		serviceName:     name,
		serviceVersion:  version,
		environment:     environment,
		attributes:      attrs,
		certificatePath: readEnv("OTEL_EXPORTER_OTLP_CERTIFICATE"),
		tracesURL:       tracesURL,
		metricsURL:      metricsURL,
		tracesGRPC:      tracesExporter == "otlp_proto_grpc",
		metricsGRPC:     metricsExporter == "otlp_proto_grpc",
	}
}

func tlsConfig(certPath string) (*tls.Config, error) {
	if certPath == "" {
		return nil, nil
	}
	pem, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, nil
	}
	return &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}, nil
}

func resourceFromConfig(cfg resolvedConfig) (*resource.Resource, error) {
	kvs := []attribute.KeyValue{
		semconv.ServiceName(cfg.serviceName),
		semconv.ServiceVersion(cfg.serviceVersion),
		semconv.ServiceNamespace(serviceNamespace),
		semconv.DeploymentEnvironmentName(cfg.environment),
	}
	for k, v := range cfg.attributes {
		kvs = append(kvs, attribute.String(k, v))
	}
	return resource.Merge(resource.Default(), resource.NewWithAttributes(semconv.SchemaURL, kvs...))
}

// Initialize starts OTLP export using the same OTEL_* env contract as @compliwise/otel.
func Initialize(logger *slog.Logger, serviceName string) {
	mu.Lock()
	defer mu.Unlock()
	if tracerProvider != nil {
		return
	}

	cfg := resolveConfig(serviceName)
	if !cfg.enabled {
		return
	}

	ctx := context.Background()
	res, err := resourceFromConfig(cfg)
	if err != nil {
		if logger != nil {
			logger.Warn("OpenTelemetry resource setup failed", "error", err)
		}
		return
	}

	tlsCfg, err := tlsConfig(cfg.certificatePath)
	if err != nil {
		if logger != nil {
			logger.Warn("OpenTelemetry certificate load failed", "error", err)
		}
		return
	}

	if cfg.tracesURL != "" {
		var exporter sdktrace.SpanExporter
		if cfg.tracesGRPC {
			opts := []otlptracegrpc.Option{
				otlptracegrpc.WithEndpoint(grpcTarget(cfg.tracesURL)),
				otlptracegrpc.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlptracegrpc.WithTLSCredentials(credentials.NewTLS(tlsCfg)))
			} else if !strings.HasPrefix(cfg.tracesURL, "https://") {
				opts = append(opts, otlptracegrpc.WithInsecure())
			}
			exporter, err = otlptracegrpc.New(ctx, opts...)
		} else {
			opts := []otlptracehttp.Option{
				otlptracehttp.WithEndpointURL(cfg.tracesURL),
				otlptracehttp.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlptracehttp.WithTLSClientConfig(tlsCfg))
			}
			exporter, err = otlptracehttp.New(ctx, opts...)
		}
		if err != nil {
			if logger != nil {
				logger.Warn("OpenTelemetry trace exporter setup failed", "error", err)
			}
			return
		}
		tp := sdktrace.NewTracerProvider(
			sdktrace.WithBatcher(exporter),
			sdktrace.WithResource(res),
		)
		otelapi.SetTracerProvider(tp)
		tracerProvider = tp
	}

	if cfg.metricsURL != "" {
		var reader metric.Reader
		if cfg.metricsGRPC {
			opts := []otlpmetricgrpc.Option{
				otlpmetricgrpc.WithEndpoint(grpcTarget(cfg.metricsURL)),
				otlpmetricgrpc.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlpmetricgrpc.WithTLSCredentials(credentials.NewTLS(tlsCfg)))
			} else if !strings.HasPrefix(cfg.metricsURL, "https://") {
				opts = append(opts, otlpmetricgrpc.WithInsecure())
			}
			exporter, metricErr := otlpmetricgrpc.New(ctx, opts...)
			if metricErr != nil {
				err = metricErr
			} else {
				reader = metric.NewPeriodicReader(exporter, metric.WithInterval(60*time.Second))
			}
		} else {
			opts := []otlpmetrichttp.Option{
				otlpmetrichttp.WithEndpointURL(cfg.metricsURL),
				otlpmetrichttp.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlpmetrichttp.WithTLSClientConfig(tlsCfg))
			}
			exporter, metricErr := otlpmetrichttp.New(ctx, opts...)
			if metricErr != nil {
				err = metricErr
			} else {
				reader = metric.NewPeriodicReader(exporter, metric.WithInterval(60*time.Second))
			}
		}
		if err != nil {
			if logger != nil {
				logger.Warn("OpenTelemetry metric exporter setup failed", "error", err)
			}
		} else if reader != nil {
			mp := metric.NewMeterProvider(metric.WithResource(res), metric.WithReader(reader))
			otelapi.SetMeterProvider(mp)
			meterProvider = mp
		}
	}

	if logger != nil {
		logger.Info("OpenTelemetry initialized",
			"service", cfg.serviceName,
			"otel_export_type", cfg.exportType,
		)
	}
}

// Shutdown flushes exporters. Safe when Initialize was a no-op.
func Shutdown(ctx context.Context) {
	mu.Lock()
	defer mu.Unlock()
	if meterProvider != nil {
		_ = meterProvider.Shutdown(ctx)
		meterProvider = nil
	}
	if tracerProvider != nil {
		_ = tracerProvider.Shutdown(ctx)
		tracerProvider = nil
	}
}

// Enabled reports whether the SDK started an exporter.
func Enabled() bool {
	mu.Lock()
	defer mu.Unlock()
	return tracerProvider != nil || meterProvider != nil
}
