"""Profile-aware home-channel notification transport and deduplication helpers."""

from typing import Optional
import logging

from gateway.run_shutdown import _notice_target_key

logger = logging.getLogger("gateway.run")


def _served_notice_target_key(profile: Optional[str], platform_value: str, chat_id, thread_id) -> tuple:
    """Notice-dedupe key for one SERVED profile's home channel.

    A secondary uses the ``<profile>:<platform>`` key convention the runtime status already
    stamps in ``gateway_state.json``; the launch profile keeps the bare platform value so a
    marker written before this change still matches its delivered targets.
    """
    return _notice_target_key(
        platform_value if profile is None else f"{profile}:{platform_value}", chat_id, thread_id)


def _safe_delivery_transport(platform, config, adapters, *, profile: Optional[str] = None):
    """``resolve_delivery_transport`` isolated to one target: ``None`` (logged) on failure.

    The fan-out spans every served profile, so one profile's broken adapter must not abort the
    pass and starve every profile after it in dict order.
    """
    from gateway.delivery import resolve_delivery_transport
    try:
        return resolve_delivery_transport(platform, config, adapters)
    except Exception as exc:
        logger.debug(
            "Home-channel transport unavailable for %s%s: %s",
            f"{profile}:" if profile else "", getattr(platform, "value", platform), exc)
        return None
