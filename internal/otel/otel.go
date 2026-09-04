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
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	otellog "go.opentelemetry.io/otel/log"
	global "go.opentelemetry.io/otel/log/global"
	sdklog "go.opentelemetry.io/otel/sdk/log"
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
	mu             sync.Mutex
	tracerProvider *sdktrace.TracerProvider
	meterProvider  *metric.MeterProvider
	loggerProvider *sdklog.LoggerProvider
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
	logsURL         string
	tracesGRPC      bool
	metricsGRPC     bool
	logsGRPC        bool
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
	logsExporter := parseExporter(readEnv("OTEL_LOGS_EXPORTER"))
	tracesURL := joinSignalURL(base, "traces", readEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"), tracesExporter)
	metricsURL := joinSignalURL(base, "metrics", readEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"), metricsExporter)
	logsURL := joinSignalURL(base, "logs", readEnv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"), logsExporter)

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
		"appVersion":             version,
		"deployment.environment": environment,
		"env":                    environment,
		"version":                version,
		"service.namespace":      serviceNamespace,
	}
	for k, v := range parseKeyValueList(readEnv("OTEL_RESOURCE_ATTRIBUTES")) {
		attrs[k] = v
	}

	hasExporter := tracesURL != "" || metricsURL != "" || logsURL != ""
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
		logsURL:         logsURL,
		tracesGRPC:      tracesExporter == "otlp_proto_grpc",
		metricsGRPC:     metricsExporter == "otlp_proto_grpc",
		logsGRPC:        logsExporter == "otlp_proto_grpc",
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

	if cfg.logsURL != "" {
		var exporter sdklog.Exporter
		if cfg.logsGRPC {
			opts := []otlploggrpc.Option{
				otlploggrpc.WithEndpoint(grpcTarget(cfg.logsURL)),
				otlploggrpc.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlploggrpc.WithTLSCredentials(credentials.NewTLS(tlsCfg)))
			} else if !strings.HasPrefix(cfg.logsURL, "https://") {
				opts = append(opts, otlploggrpc.WithInsecure())
			}
			exporter, err = otlploggrpc.New(ctx, opts...)
		} else {
			opts := []otlploghttp.Option{
				otlploghttp.WithEndpointURL(cfg.logsURL),
				otlploghttp.WithHeaders(cfg.headers),
			}
			if tlsCfg != nil {
				opts = append(opts, otlploghttp.WithTLSClientConfig(tlsCfg))
			}
			exporter, err = otlploghttp.New(ctx, opts...)
		}
		if err != nil {
			if logger != nil {
				logger.Warn("OpenTelemetry log exporter setup failed", "error", err)
			}
		} else {
			lp := sdklog.NewLoggerProvider(
				sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
				sdklog.WithResource(res),
			)
			global.SetLoggerProvider(lp)
			loggerProvider = lp
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
	if loggerProvider != nil {
		_ = loggerProvider.Shutdown(ctx)
		loggerProvider = nil
	}
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
	return tracerProvider != nil || meterProvider != nil || loggerProvider != nil
}

// fanoutHandler broadcasts each slog record to several handlers, so the app's
// existing stdout logs also flow to the OTLP logs pipeline.
type fanoutHandler struct{ handlers []slog.Handler }

func (f fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, h := range f.handlers {
		if h.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (f fanoutHandler) Handle(ctx context.Context, r slog.Record) error {
	var firstErr error
	for _, h := range f.handlers {
		if h.Enabled(ctx, r.Level) {
			if err := h.Handle(ctx, r.Clone()); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (f fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, len(f.handlers))
	for i, h := range f.handlers {
		next[i] = h.WithAttrs(attrs)
	}
	return fanoutHandler{handlers: next}
}

func (f fanoutHandler) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, len(f.handlers))
	for i, h := range f.handlers {
		next[i] = h.WithGroup(name)
	}
	return fanoutHandler{handlers: next}
}

// WrapSlogHandler returns base unchanged when OTLP logs export is not enabled;
// otherwise a handler that fans records out to both base (stdout) and the OTLP
// logs pipeline, so gateway logs appear in Statsig Logs and not only Traces.
func WrapSlogHandler(base slog.Handler, serviceName string) slog.Handler {
	mu.Lock()
	lp := loggerProvider
	mu.Unlock()
	if lp == nil {
		return base
	}
	bridge := &otelLogHandler{logger: lp.Logger(serviceName)}
	return fanoutHandler{handlers: []slog.Handler{base, bridge}}
}

// otelLogHandler is a minimal slog.Handler that emits records to the OTLP logs
// pipeline via the OTel log API. Hand-written to avoid the contrib otelslog
// bridge, whose current release requires a newer Go toolchain than the proxy.
type otelLogHandler struct {
	logger otellog.Logger
	attrs  []otellog.KeyValue
	group  string
}

func (h *otelLogHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *otelLogHandler) Handle(ctx context.Context, r slog.Record) error {
	var rec otellog.Record
	rec.SetTimestamp(r.Time)
	rec.SetBody(otellog.StringValue(r.Message))
	rec.SetSeverity(slogToOtelSeverity(r.Level))
	if len(h.attrs) > 0 {
		rec.AddAttributes(h.attrs...)
	}
	r.Attrs(func(a slog.Attr) bool {
		rec.AddAttributes(slogAttrToKV(h.group, a))
		return true
	})
	h.logger.Emit(ctx, rec)
	return nil
}

func (h *otelLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := append([]otellog.KeyValue{}, h.attrs...)
	for _, a := range attrs {
		next = append(next, slogAttrToKV(h.group, a))
	}
	return &otelLogHandler{logger: h.logger, attrs: next, group: h.group}
}

func (h *otelLogHandler) WithGroup(name string) slog.Handler {
	g := name
	if h.group != "" {
		g = h.group + "." + name
	}
	return &otelLogHandler{logger: h.logger, attrs: h.attrs, group: g}
}

func slogToOtelSeverity(l slog.Level) otellog.Severity {
	switch {
	case l >= slog.LevelError:
		return otellog.SeverityError
	case l >= slog.LevelWarn:
		return otellog.SeverityWarn
	case l >= slog.LevelInfo:
		return otellog.SeverityInfo
	default:
		return otellog.SeverityDebug
	}
}

func slogAttrToKV(group string, a slog.Attr) otellog.KeyValue {
	key := a.Key
	if group != "" {
		key = group + "." + key
	}
	return otellog.String(key, a.Value.String())
}
