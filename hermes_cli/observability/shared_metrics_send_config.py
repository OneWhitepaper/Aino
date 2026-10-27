"""Configuration for shared-metrics transmission."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

#: Consent names Aino's receiver. Loopback overrides support isolated transport tests;
#: neither an inherited environment variable nor a config edit can authorize another recipient.
DEFAULT_ENDPOINT = "https://api.agentera.com.cn/api/v1/desktop/shared-metrics"
RECIPIENT = "aino"
LEGACY_ENDPOINT = "https://telemetry.nousresearch.com/v1/telemetry"

_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})

# Module-level latch: the enabled/send mismatch is a static misconfiguration,
# so it is reported once per process instead of on every hook fire.
_warned_send_without_collection = False


@dataclass(frozen=True)
class SendConfig:
    """Resolved transmission settings."""

    #: Collection is on. Nothing is packaged or sent without it.
    enabled: bool
    #: Transmission is on AND permitted (that is, collection is also on).
    send: bool
    #: Where packages are POSTed.
    endpoint: str


def _endpoint_is_safe(endpoint: str) -> bool:
    """Aino consent permits the declared receiver or an isolated loopback test server."""
    if endpoint == DEFAULT_ENDPOINT:
        return True
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and (parsed.hostname or "") in _LOCAL_HOSTS


def resolve_send_config(config: dict | None) -> SendConfig:
    """Resolve transmission settings from config (endpoint: config > production default).

    ``send`` is False whenever transmission cannot legitimately happen, so callers never
    have to re-check the combination.
    """
    global _warned_send_without_collection

    raw = config if isinstance(config, dict) else {}
    telemetry = raw.get("telemetry")
    telemetry = telemetry if isinstance(telemetry, dict) else {}
    shared = telemetry.get("shared_metrics")
    shared = shared if isinstance(shared, dict) else {}

    enabled = shared.get("enabled") is True
    send_requested = shared.get("send") is True

    if send_requested and not enabled:
        # Loud, not silent: the user believes telemetry is being sent, and it never will be.
        if not _warned_send_without_collection:
            _warned_send_without_collection = True
            logger.error(
                "telemetry.shared_metrics.send is true but "
                "telemetry.shared_metrics.enabled is false — nothing is "
                "collected, so nothing can be sent. Enable collection or "
                "turn sending off."
            )
        return SendConfig(enabled=False, send=False, endpoint=DEFAULT_ENDPOINT)

    endpoint = shared.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint.strip():
        endpoint = DEFAULT_ENDPOINT
    endpoint = endpoint.strip()
    if endpoint == LEGACY_ENDPOINT:
        endpoint = DEFAULT_ENDPOINT

    # Consent belongs to a recipient. A Nous opt-in cannot authorize Aino.
    if shared.get("recipient") != RECIPIENT:
        return SendConfig(enabled=enabled, send=False, endpoint=endpoint)

    if send_requested and not _endpoint_is_safe(endpoint):
        logger.error(
            "Refusing to send shared metrics to %r: Aino consent permits only its https "
            "endpoint (or a loopback endpoint for testing).",
            endpoint,
        )
        return SendConfig(enabled=enabled, send=False, endpoint=endpoint)

    return SendConfig(enabled=enabled, send=send_requested, endpoint=endpoint)
