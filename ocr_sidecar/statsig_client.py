import logging
import os
from typing import Any

logger = logging.getLogger("ocr_sidecar")

_statsig: Any = None
_user: Any = None
_StatsigUser: Any = None


def initialize(service_name: str = "ocr-sidecar") -> bool:
    global _statsig, _user, _StatsigUser

    server_key = os.getenv("STATSIG_SERVER_KEY", "").strip()
    if not server_key:
        return False

    try:
        from statsig_python_core import Statsig, StatsigOptions, StatsigUser
    except ImportError:
        logger.warning("statsig-python-core is not installed; skipping Statsig")
        return False

    options = StatsigOptions()
    options.environment = os.getenv("NODE_ENV", "").strip()
    if options.environment.lower() == "production":
        options.environment = "production"
    elif os.getenv("ENVIRONMENT", "").strip():
        options.environment = os.getenv("ENVIRONMENT", "").strip()
    elif not options.environment:
        options.environment = "development"
    client = Statsig(server_key, options)
    client.initialize().wait()
    _statsig = client
    _StatsigUser = StatsigUser
    _user = StatsigUser(service_name)
    log_event("ocr.sidecar_started")
    logger.info("Statsig initialized")
    return True


def _resolve_user(user: Any | None = None, user_id: str | None = None) -> Any | None:
    if user is not None:
        return user
    if user_id and _StatsigUser is not None:
        return _StatsigUser(user_id)
    return _user


def log_event(
    event_name: str,
    value: str | int | None = None,
    metadata: dict[str, str] | None = None,
    user: Any | None = None,
) -> None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return
    _statsig.log_event(
        user=resolved,
        event_name=event_name,
        value=value,
        metadata=metadata or {},
    )


def check_gate(gate_name: str, user: Any | None = None) -> bool:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return False
    return bool(_statsig.check_gate(resolved, gate_name))


def get_feature_gate(gate_name: str, user: Any | None = None) -> Any | None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return None
    return _statsig.get_feature_gate(resolved, gate_name)


def get_dynamic_config(config_name: str, user: Any | None = None) -> Any | None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return None
    return _statsig.get_dynamic_config(resolved, config_name)


def get_experiment(experiment_name: str, user: Any | None = None) -> Any | None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return None
    return _statsig.get_experiment(resolved, experiment_name)


def get_layer(layer_name: str, user: Any | None = None) -> Any | None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return None
    return _statsig.get_layer(resolved, layer_name)


def get_parameter_store(store_name: str, user: Any | None = None) -> Any | None:
    resolved = _resolve_user(user)
    if _statsig is None or resolved is None:
        return None
    return _statsig.get_parameter_store(resolved, store_name)


def shutdown() -> None:
    global _statsig, _user, _StatsigUser
    if _statsig is None:
        return
    _statsig.shutdown().wait()
    _statsig = None
    _user = None
    _StatsigUser = None
