"""Profile observability on the canonical transport; consent and collection never upload."""
import asyncio
from functools import partial

from hermes_state_runtime import RuntimeStoreError


def handlers(connection):
    return {"diagnostics.collect": partial(collect, connection),
            "shared_metrics.status": partial(shared_metrics, connection, write=False),
            "shared_metrics.set": partial(shared_metrics, connection, write=True)}


async def shared_metrics(connection, ref, params, *, write):
    from gateway.session_config import _authorize
    from pydantic import ValidationError
    from tui_gateway.contracts.common import ProfileParams
    from tui_gateway.contracts.config_free_tier_control import SharedMetricsSetParams

    _authorize(connection, ref, params)
    if write and "session:operator" not in connection.actor.capabilities:
        raise RuntimeStoreError("permission_denied")
    try:
        request = (SharedMetricsSetParams if write else ProfileParams).model_validate(params)
    except ValidationError as exc:
        raise RuntimeStoreError("invalid_params") from exc
    if write and request.enabled and request.send and request.recipient != "aino":
        raise RuntimeStoreError("invalid_params")

    def apply():
        from hermes_cli.config import is_managed, read_raw_config
        from hermes_cli.observability.shared_metrics_consent import consent_state, save_consent

        if write:
            if is_managed():
                raise RuntimeStoreError("permission_denied")
            from gateway.session_tui_config import _WRITE_LOCK
            # Share the existing profile-config writer lock; dispatch/to_thread retain owner_scope.
            with _WRITE_LOCK:
                try:
                    save_consent(request.enabled, request.send)
                except (OSError, RuntimeError) as exc:
                    raise RuntimeStoreError("storage_unavailable") from exc
            if not request.enabled:
                from hermes_cli.observability.shared_metrics_desktop import purge_onboarding_latches
                purge_onboarding_latches()
            if request.first_run:
                from tui_gateway.methods_shared_metrics import _shared_metrics_record_setup_completed
                _shared_metrics_record_setup_completed(read_raw_config())
        return consent_state(read_raw_config())

    return await asyncio.to_thread(apply)


async def collect(connection, ref, params):
    # A session reader is not entitled to the profile's full agent/gateway logs.
    if connection.actor.profile_id != connection.authority.profile_id:
        raise RuntimeStoreError("profile_mismatch")
    if "session:operator" not in connection.actor.capabilities:
        raise RuntimeStoreError("permission_denied")
    from hermes_cli.debug_client_bundle import collect_client_result
    # AuthorityConnection.dispatch binds owner_scope; to_thread carries that scope.
    return await asyncio.to_thread(collect_client_result, params)
