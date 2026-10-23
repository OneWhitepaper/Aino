"""Operator-authorized collection on the canonical transport; never network upload."""
import asyncio
from functools import partial

from hermes_state_runtime import RuntimeStoreError


def handlers(connection):
    return {"diagnostics.collect": partial(collect, connection)}


async def collect(connection, ref, params):
    # A session reader is not entitled to the profile's full agent/gateway logs.
    if connection.actor.profile_id != connection.authority.profile_id:
        raise RuntimeStoreError("profile_mismatch")
    if "session:operator" not in connection.actor.capabilities:
        raise RuntimeStoreError("permission_denied")
    from hermes_cli.debug_client_bundle import collect_client_result
    # AuthorityConnection.dispatch binds owner_scope; to_thread carries that scope.
    return await asyncio.to_thread(collect_client_result, params)
