"""Aino's existing ephemeral model binding on a canonical local session."""

import asyncio
import json
import logging

from hermes_state_runtime import RuntimeStoreError
from tui_gateway.managed_model_runtime import ManagedBindingError, get_registry, persisted_managed_model_metadata
from tui_gateway.methods_managed_model import _binding, _managed_owner, _managed_text

logger = logging.getLogger(__name__)


def selection_for_policy(policy):
    if policy is None:
        return None
    model = (policy.config().get("model") or {})
    if model.get("model_source") == "aino":
        return {"model_source": "aino", "model_id": model.get("model_id")}
    request = json.loads(policy.request_json)
    if request.get("model_source") == "aino" and model.get("provider") == "aino":
        return {"model_source": "aino", "model_id": request.get("model_id")}
    return None


def binding_key(authority, sid):
    return f"{authority.profile_id}\0{sid}"


def managed_state(authority, sid):
    live = authority.sessions.get(sid)
    if live is None:
        raise RuntimeStoreError("not_found")
    from gateway.session_policy import policy_for_source
    selected = selection_for_policy(policy_for_source(authority.runner, live.source))
    if selected is None:
        raise RuntimeStoreError("managed_binding_forbidden")
    state = getattr(live, "managed_model_state", None)
    if state is None:
        state = {"managed_model_params": selected, "transport": None}
        live.managed_model_state = state
    return state


def clear_managed_selection(authority, sid):
    """A committed model edit retires the old credential before its new route can run."""
    get_registry().clear_session(binding_key(authority, sid))
    live = authority.sessions.get(sid)
    if live is not None:
        live.__dict__.pop("managed_model_state", None)


def _owned(connection, ref, *, issuer=False):
    if issuer:
        if ref.session_id not in connection.subscriptions:
            raise RuntimeStoreError("permission_denied")
        connection.authority.authorize(connection.actor, ref, "session:control")
    live = connection.authority.sessions.get(ref.session_id)
    if live is None:
        raise RuntimeStoreError("managed_binding_forbidden")
    from gateway.session_policy import policy_for_source
    policy = policy_for_source(connection.authority.runner, live.source)
    if policy is None or policy.source != "gui":
        raise RuntimeStoreError("managed_binding_forbidden")
    state = managed_state(connection.authority, ref.session_id)
    from tui_gateway.managed_model_runtime import transport_principal
    try:
        transport_principal(connection.transport)
    except ManagedBindingError as exc:
        raise RuntimeStoreError(str(exc)) from None
    state["running"] = connection.authority._handle(ref).execution_state == "running"
    state["_interrupt_managed"] = lambda: _interrupt_active(connection.authority, ref)
    return live, state


def _interrupt_active(authority, ref):
    from agent.interrupt_compat import request_hard_interrupt
    try:
        if authority._handle(ref).execution_state != "running":
            return
    except RuntimeStoreError:
        return
    agent = authority.agent(ref)
    if agent is not None:
        request_hard_interrupt(agent)


def _persist(authority, sid, binding):
    from gateway.session_ancillary import physical_target
    from gateway.session_contract import SessionRef
    target = physical_target(authority, SessionRef(authority.profile_id, sid))
    metadata = persisted_managed_model_metadata(binding)
    authority.db.patch_session_model_config(target, {**metadata, "provider": "aino", "base_url": None})


def managed_agent_context(agent, authority, sid):
    """A renewed lease changes capacity, not the cached prompt or tool snapshot."""
    from agent.auxiliary_billing_scope import ManagedCredential
    key = getattr(agent, "api_key", None)
    if not isinstance(key, ManagedCredential):
        return
    state = managed_state(authority, sid)
    binding = get_registry().get(binding_key(authority, sid), state)
    if binding is None:
        raise RuntimeStoreError("awaiting_managed_credentials")
    agent._managed_model_metadata = persisted_managed_model_metadata(binding)
    window = key.get_context_window() if key.get_context_window is not None else None
    compressor = getattr(agent, "context_compressor", None)
    if type(window) is int and window > 0 and compressor is not None:
        compressor.context_length = window


async def ticket(connection, ref, params):
    live, _ = _owned(connection, ref, issuer=True)
    async with live.mutation_lock:
        _, state = _owned(connection, ref, issuer=True)
        peer = connection.transport
        key = binding_key(connection.authority, ref.session_id)
        if state.get("transport") not in (None, peer):
            get_registry().clear_session(key)
        state["transport"] = peer
        try:
            owner, model_id = _managed_owner(params), _managed_text(params, "model_id", 128)
            value = get_registry().issue(key, state, peer, owner, model_id)
        except (ManagedBindingError, ValueError, TypeError) as exc:
            raise RuntimeStoreError(str(exc)) from None
    return {"session_ticket": value, "managed_model_binding": 1}


async def claim(connection, ref, params):
    live, _ = _owned(connection, ref)
    async with live.mutation_lock:
        _, state = _owned(connection, ref)
        try:
            revision = get_registry().claim(binding_key(connection.authority, ref.session_id), state, connection.transport,
                                            _managed_text(params, "session_ticket"),
                                            _managed_owner(params), _managed_text(params, "model_id", 128))
        except (ManagedBindingError, ValueError, TypeError) as exc:
            raise RuntimeStoreError(str(exc)) from None
    return {"binding_revision": revision, "managed_model_binding": 1,
            "managed_model_context_window": True}


async def bind(connection, ref, params):
    live, _ = _owned(connection, ref)
    async with live.mutation_lock:
        _, state = _owned(connection, ref)
        try:
            binding = _binding(params, binding_key(connection.authority, ref.session_id))
            get_registry().bind(binding, state, connection.transport)
        except (ManagedBindingError, ValueError, TypeError, OverflowError) as exc:
            raise RuntimeStoreError(str(exc)) from None
        try:
            await asyncio.to_thread(_persist, connection.authority, ref.session_id, binding)
        except Exception:  # health: allow BLE001 -- clear an in-memory lease on any failed durable bind
            logger.exception("managed model metadata persistence failed")
            get_registry().clear(binding.session_id, binding.binding_revision, connection.transport)
            raise RuntimeStoreError("storage_unavailable") from None
    return {"bound": True, "model_id": binding.model_id, "binding_revision": binding.binding_revision}


async def renew(connection, ref, params):
    live, _ = _owned(connection, ref)
    async with live.mutation_lock:
        _, state = _owned(connection, ref)
        try:
            binding = _binding(params, binding_key(connection.authority, ref.session_id))
            get_registry().renew(binding, state, connection.transport)
        except (ManagedBindingError, ValueError, TypeError, OverflowError) as exc:
            raise RuntimeStoreError(str(exc)) from None
    return {"bound": True, "model_id": binding.model_id, "binding_revision": binding.binding_revision}


async def clear(connection, ref, params):
    live, _ = _owned(connection, ref)
    revision = params.get("binding_revision")
    if type(revision) is not int or revision <= 0:
        raise RuntimeStoreError("invalid_params")
    async with live.mutation_lock:
        try:
            removed = get_registry().clear(binding_key(connection.authority, ref.session_id), revision,
                                           connection.transport)
        except ManagedBindingError as exc:
            raise RuntimeStoreError(str(exc)) from None
    return {"cleared": removed}


def handlers(connection):
    from functools import partial
    return {
        "session.managed_model_ticket": partial(ticket, connection),
        "session.claim_managed_model": partial(claim, connection),
        "session.bind_managed_model": partial(bind, connection),
        "session.renew_managed_model": partial(renew, connection),
        "session.clear_managed_model": partial(clear, connection),
    }


def managed_info(authority, sid):
    from gateway.session_policy import policy_for_source
    live = authority.sessions.get(sid)
    selected = selection_for_policy(policy_for_source(authority.runner, live.source)) if live else None
    if not selected:
        return {}
    state = managed_state(authority, sid)
    binding = get_registry().get(binding_key(authority, sid), state)
    from gateway.session_ancillary import physical_target
    from gateway.session_contract import SessionRef
    target = physical_target(authority, SessionRef(authority.profile_id, sid))
    owner = authority.db.get_session_model_config_value(target, "platform_owner")
    metadata = persisted_managed_model_metadata(binding) if binding else {
        **selected, **({"platform_owner": owner} if owner else {})}
    return {**metadata, "provider": "aino", "model_status": "ready" if binding else "awaiting_managed_credentials"}
