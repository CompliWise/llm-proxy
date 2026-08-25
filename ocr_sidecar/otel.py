# Keep in sync with apps/certiwise-api/otel.py.
# Same OTEL_* / STATSIG_SERVER_KEY contract as packages/otel (@compliwise/otel).

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

STATSIG_OTLP_ENDPOINT = "https://api.statsig.com/otlp"
STATSIG_OTLP_HEADER_NAME = "statsig-api-key"

_SIGNAL_PATHS = {
    "logs": "/v1/logs",
    "metrics": "/v1/metrics",
    "traces": "/v1/traces",
}

_EXPORTER_ALIASES = {
    "grpc": "otlp_proto_grpc",
    "none": "none",
    "otlp": "otlp_proto_http",
    "otlp_proto_grpc": "otlp_proto_grpc",
    "otlp_proto_http": "otlp_proto_http",
    "http/protobuf": "otlp_proto_http",
}

_provider: Any = None
_meter_provider: Any = None
_logger_provider: Any = None
_enabled = False


def _read_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def parse_boolean_env(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    return default


def parse_otel_export_type(value: str | None) -> str:
    return "statsig" if (value or "").strip().lower() == "statsig" else "otlp"


def parse_otlp_exporter(value: str | None, default: str = "otlp_proto_http") -> str:
    if not value or not value.strip():
        return default
    return _EXPORTER_ALIASES.get(value.strip().lower(), default)


def parse_key_value_list(value: str | None) -> dict[str, str]:
    if not value or not value.strip():
        return {}
    next_pairs: dict[str, str] = {}
    for pair in value.split(","):
        trimmed = pair.strip()
        if not trimmed:
            continue
        separator_index = trimmed.find("=")
        if separator_index <= 0:
            continue
        key = trimmed[:separator_index].strip()
        pair_value = trimmed[separator_index + 1 :].strip()
        if key:
            next_pairs[key] = pair_value
    return next_pairs


def _trim_trailing_slash(endpoint: str) -> str:
    return endpoint.rstrip("/")


def _strip_otlp_signal_path(endpoint: str) -> str:
    normalized = _trim_trailing_slash(endpoint)
    for path in _SIGNAL_PATHS.values():
        if normalized.endswith(path):
            return normalized[: -len(path)]
    return normalized


def _join_otlp_signal_url(
    base_endpoint: str | None,
    signal: str,
    explicit_endpoint: str | None,
    transport: str,
) -> str | None:
    path = _SIGNAL_PATHS[signal]
    candidate = (explicit_endpoint or "").strip() or (base_endpoint or "").strip()
    if not candidate:
        return None
    normalized = _trim_trailing_slash(candidate)
    if transport == "grpc":
        return _strip_otlp_signal_path(normalized)
    if normalized.endswith(path):
        return normalized
    return f"{normalized}{path}"


def _resolve_base_endpoint(export_type: str) -> str | None:
    return _read_env("OTEL_EXPORTER_OTLP_ENDPOINT") or (
        STATSIG_OTLP_ENDPOINT if export_type == "statsig" else None
    )


def _resolve_service_version() -> str:
    return (
        _read_env("OTEL_SERVICE_VERSION")
        or _read_env("VERSION")
        or _read_env("NEXT_PUBLIC_APP_VERSION")
        or "0.0.0"
    )


def _statsig_otlp_headers(server_key: str | None) -> dict[str, str]:
    key = (server_key or "").strip()
    if not key:
        return {}
    return {STATSIG_OTLP_HEADER_NAME: key}


def resolve_otlp_config(service_name: str) -> dict[str, Any]:
    export_type = parse_otel_export_type(_read_env("OTEL_EXPORT_TYPE"))
    enabled = parse_boolean_env(os.getenv("OTEL_ENABLED"), True)
    base_endpoint = _resolve_base_endpoint(export_type)
    traces_exporter = parse_otlp_exporter(_read_env("OTEL_TRACES_EXPORTER"))
    metrics_exporter = parse_otlp_exporter(_read_env("OTEL_METRICS_EXPORTER"))
    traces_transport = "grpc" if traces_exporter == "otlp_proto_grpc" else "http"
    metrics_transport = "grpc" if metrics_exporter == "otlp_proto_grpc" else "http"

    traces_url = (
        None
        if traces_exporter == "none"
        else _join_otlp_signal_url(
            base_endpoint,
            "traces",
            _read_env("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
            traces_transport,
        )
    )
    metrics_url = (
        None
        if metrics_exporter == "none"
        else _join_otlp_signal_url(
            base_endpoint,
            "metrics",
            _read_env("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
            metrics_transport,
        )
    )
    logs_url = (
        None
        if traces_exporter == "none"
        else _join_otlp_signal_url(
            base_endpoint,
            "logs",
            _read_env("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"),
            traces_transport,
        )
    )

    headers: dict[str, str] = {}
    if export_type == "statsig":
        headers.update(_statsig_otlp_headers(_read_env("STATSIG_SERVER_KEY")))
    headers.update(parse_key_value_list(_read_env("OTEL_EXPORTER_OTLP_HEADERS")))

    environment = (
        _read_env("OTEL_ENVIRONMENT")
        or _read_env("NODE_ENV")
        or _read_env("ENVIRONMENT")
        or "development"
    )
    service_version = _resolve_service_version()
    attributes = {
        "appVersion": service_version,
        "deployment.environment": environment,
        "env": environment,
        "version": service_version,
        "service.namespace": "compliwise",
        **parse_key_value_list(_read_env("OTEL_RESOURCE_ATTRIBUTES")),
    }

    has_exporter = bool(traces_url or metrics_url or logs_url)
    statsig_missing_auth = export_type == "statsig" and not headers.get(
        STATSIG_OTLP_HEADER_NAME
    )
    can_export = has_exporter and not statsig_missing_auth
    resolved_enabled = enabled and can_export

    return {
        "attributes": attributes,
        "certificate_path": _read_env("OTEL_EXPORTER_OTLP_CERTIFICATE"),
        "enabled": resolved_enabled,
        "export_type": export_type,
        "headers": headers,
        "logs_url": logs_url if can_export else None,
        "metrics_exporter": metrics_exporter,
        "metrics_url": metrics_url if can_export else None,
        "service_name": _read_env("OTEL_SERVICE_NAME") or service_name,
        "service_version": service_version,
        "traces_exporter": traces_exporter,
        "traces_url": traces_url if can_export else None,
    }


def _grpc_target(url: str) -> str:
    stripped = url.replace("https://", "").replace("http://", "")
    return _strip_otlp_signal_path(stripped)


def _build_exporter(kind: str, signal: str, url: str, headers: dict[str, str], certificate_path: str | None):
    if kind == "otlp_proto_grpc":
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
            OTLPMetricExporter as GrpcMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter as GrpcSpanExporter,
        )

        kwargs: dict[str, Any] = {
            "endpoint": _grpc_target(url),
            "headers": tuple(headers.items()),
            "insecure": not url.startswith("https://") and "443" not in url,
        }
        if signal == "traces":
            return GrpcSpanExporter(**kwargs)
        if signal == "metrics":
            return GrpcMetricExporter(**kwargs)
        try:
            from opentelemetry.exporter.otlp.proto.grpc._log_exporter import (
                OTLPLogExporter as GrpcLogExporter,
            )
        except ImportError:
            from opentelemetry.exporter.otlp.proto.http._log_exporter import (
                OTLPLogExporter as GrpcLogExporter,
            )
        return GrpcLogExporter(**kwargs)

    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

    kwargs = {"endpoint": url, "headers": headers}
    if certificate_path:
        kwargs["certificate_file"] = certificate_path
    if signal == "traces":
        return OTLPSpanExporter(**kwargs)
    if signal == "metrics":
        return OTLPMetricExporter(**kwargs)
    return OTLPLogExporter(**kwargs)


def initialize_otel(*, service_name: str) -> bool:
    global _provider, _meter_provider, _logger_provider, _enabled

    if os.getenv("NODE_ENV") == "test" or os.getenv("PYTEST_CURRENT_TEST"):
        return False
    if _provider is not None:
        return _enabled

    config = resolve_otlp_config(service_name)
    if not config["enabled"]:
        return False

    try:
        from opentelemetry import metrics, trace
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.instrumentation.logging import LoggingInstrumentor
    except ImportError:
        logger.warning("OpenTelemetry packages are not installed; skipping OTEL")
        return False

    resource = Resource.create(
        {
            "service.name": config["service_name"],
            "service.version": config["service_version"],
            **config["attributes"],
        }
    )
    headers = config["headers"]
    certificate_path = config["certificate_path"]

    provider = TracerProvider(resource=resource)
    if config["traces_url"]:
        provider.add_span_processor(
            BatchSpanProcessor(
                _build_exporter(
                    config["traces_exporter"],
                    "traces",
                    config["traces_url"],
                    headers,
                    certificate_path,
                )
            )
        )
    trace.set_tracer_provider(provider)
    _provider = provider

    if config["metrics_url"]:
        reader = PeriodicExportingMetricReader(
            _build_exporter(
                config["metrics_exporter"],
                "metrics",
                config["metrics_url"],
                headers,
                certificate_path,
            ),
            export_interval_millis=60_000,
        )
        meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
        metrics.set_meter_provider(meter_provider)
        _meter_provider = meter_provider

    if config["logs_url"]:
        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(
            BatchLogRecordProcessor(
                _build_exporter(
                    config["traces_exporter"],
                    "logs",
                    config["logs_url"],
                    headers,
                    certificate_path,
                )
            )
        )
        set_logger_provider(logger_provider)
        logging.getLogger().addHandler(
            LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider)
        )
        _logger_provider = logger_provider
        LoggingInstrumentor().instrument(set_logging_format=False)

    _enabled = True
    logger.info(
        "OpenTelemetry initialized",
        extra={
            "otel_export_type": config["export_type"],
            "service_name": config["service_name"],
        },
    )
    return True


def instrument_fastapi(app: Any) -> None:
    if not _enabled:
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except ImportError:
        return
    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()


def shutdown_otel() -> None:
    global _provider, _meter_provider, _logger_provider, _enabled
    for provider in (_provider, _meter_provider, _logger_provider):
        if provider is None:
            continue
        try:
            provider.shutdown()
        except Exception:
            logger.exception("Failed to shut down OpenTelemetry provider")
    _provider = None
    _meter_provider = None
    _logger_provider = None
    _enabled = False
