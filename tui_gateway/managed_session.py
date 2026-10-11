"""Platform session identity and live authentication, separate from profile defaults."""

import time

from .managed_model_runtime import ManagedBindingError, get_registry, resolve_managed_runtime


def managed_metadata(value):
    if not isinstance(value, dict) or value.get("model_source") != "aino":
        return None
    # Never copy credentials/URLs or arbitrary renderer fields into a stored row.
    result = {k: value[k] for k in ("model_source", "model_id", "model", "api_mode") if k in value}
    if isinstance(owner := value.get("platform_owner"), dict):
        result["platform_owner"] = {k: owner.get(k) for k in ("platform_origin", "user_id")}
    return result


def transport_may_use_session(session, transport):
    """A live managed session can move only within its authenticated principal."""
    if not session.get("managed_model_params") or transport is session.get("transport"):
        return True
    from .managed_model_runtime import transport_principal
    try:
        owner = transport_principal(session.get("transport"))
        return owner is not None and transport_principal(transport) == owner
    except ManagedBindingError:
        return False


def validate_selection(session, owner, model_id):
    selected = session.get("managed_model_params")
    if not selected:
        return
    if selected.get("model_id") != model_id or (
        selected.get("platform_owner") and selected["platform_owner"] != {
            "platform_origin": owner.platform_origin, "user_id": owner.user_id}
    ):
        raise ManagedBindingError("managed_model_identity_mismatch")


def model_status(session, sid=None):
    metadata = managed_metadata(session.get("managed_model_params"))
    if metadata is None:
        return {}
    return {**metadata, "provider": "aino", "model": metadata.get("model", ""),
            "billing_source": "aino", "model_status": "ready" if sid and not session.get("managed_pending_switch")
            and get_registry().get(sid, session)
            else "awaiting_managed_credentials"}


def require_binding(sid, session):
    binding = get_registry().get(sid, session)
    if binding is None:
        raise ManagedBindingError("awaiting_managed_credentials")
    validate_selection(session, binding.owner, binding.model_id)
    return binding


def runtime_for_session(sid):
    from . import server
    with server._sessions_lock:
        session = server._sessions.get(sid)
        if not session:
            raise ManagedBindingError("awaiting_managed_credentials")
        binding = require_binding(sid, session)
    runtime = resolve_managed_runtime(binding, now=time.time())
    if "credential_expired" in runtime:
        raise ManagedBindingError("awaiting_managed_credentials")
    # Capture identity, never the secret. SDKs resolve this callable on each HTTP
    # request, including retries. Renewal cannot mutate prompt/history/tools.
    identity = (binding.owner, binding.model_id, binding.model, binding.api_mode, binding.base_url)

    def current_binding():
        current = require_binding(sid, session)
        if identity != (current.owner, current.model_id, current.model, current.api_mode, current.base_url):
            raise ManagedBindingError("managed_model_identity_mismatch")
        return current

    def current_key():
        return current_binding().api_key

    def on_override(provider, purpose):
        current_key()
        server._emit("notification.show", sid, {
            "text": f"Auxiliary calls use {provider}; charges belong to that provider, not Aino.",
            "code": "auxiliary_billing_override", "billing_source": provider,
            "purpose": purpose, "key": f"billing.source.{purpose}", "kind": "ttl", "ttl_ms": 12000, "level": "info"})

    from agent.auxiliary_billing_scope import ManagedCredential
    from .managed_model_usage import usage_session_id
    runtime["api_key"] = ManagedCredential(
        current_key, binding.owner.user_id, usage_session_id(session),
        binding.model, binding.base_url, runtime["api_mode"], bool(binding.capabilities.get("vision")),
        on_override=on_override, get_context_window=lambda: current_binding().context_window)
    return runtime.pop("model"), runtime


def sync_bound_context(sid, session):
    """Refresh only numeric budgets after a lease update, keeping the cached conversation intact."""
    from . import server
    from agent.auxiliary_billing_scope import ManagedCredential
    from agent.model_metadata import get_model_context_length

    binding = require_binding(sid, session)
    if binding.context_window is None:
        return
    agent = session.get("agent")
    pending = [agent] if agent is not None else []
    with server._session_profile_runtime_scope(session, hydrate_secrets=False):
        while pending:
            current = pending.pop()
            key = getattr(current, "api_key", None)
            compressor = getattr(current, "context_compressor", None)
            if (isinstance(key, ManagedCredential) and key.get_context_window is not None
                    and current.model == binding.model and current.base_url == binding.base_url
                    and compressor is not None):
                compressor.context_length = get_model_context_length(
                    current.model, base_url=current.base_url, api_key=key, provider=current.provider,
                    config_context_length=getattr(current, "_config_context_length", None))
            with current._active_children_lock:
                pending.extend(current._active_children)
    server._emit("session.info", sid, server._session_info(agent, session))


def submit_refusal(sid, session):
    if not session.get("managed_model_params"):
        return None
    if session.get("managed_pending_switch"):
        return "awaiting_managed_credentials"
    try:
        require_binding(sid, session)
    except ManagedBindingError as exc:
        return str(exc)
    return None


def release_selection(sid, session):
    get_registry().clear_session(sid)
    for field in ("managed_model_params", "managed_pending_switch", "resume_runtime_overrides"):
        session.pop(field, None)
    if agent := session.get("agent"):
        agent._managed_model_metadata = None


def select_model(sid, session, model_id, confirmed):
    """Stage a user-selected catalog id via config.set; no auth or global config writes."""
    from . import server
    if (not session or server._session_source(session) != "desktop"
            or not isinstance(model_id, str) or not model_id.strip() or len(model_id) > 128):
        raise ManagedBindingError("managed_binding_forbidden")
    peer = server.current_transport()
    with session["history_lock"]:
        with server._session_transport_lock:
            if not server._session_transport_contains(session, peer):
                raise ManagedBindingError("managed_binding_forbidden")
            ready = session.get("agent_ready")
            if session.get("running") or (session.get("agent_build_started") and ready and not ready.is_set()):
                raise ManagedBindingError("managed_binding_busy")
            previous = session.get("managed_model_params") or {}
            if previous.get("model_id") == model_id:
                return False
            if session.get("history") and not confirmed:
                return True
            selected = {"model_source": "aino", "model_id": model_id}
            if previous.get("platform_owner"):
                selected["platform_owner"] = previous["platform_owner"]
            if not previous:
                # A shared ordinary session becomes one socket's managed authority.
                # Retired viewers must not regain it through disconnect failover.
                session["transport"] = peer
                viewers = session.get("viewers") or {}
                session["viewers"] = {peer: viewers.get(peer, time.time())}
            session["managed_model_params"] = selected
            session["managed_pending_switch"] = True
        get_registry().clear_session(sid)
    return False


def apply_bound_selection(sid, session):
    """Commit only the selected, bound runtime through the existing switch machinery."""
    if not session.get("managed_pending_switch"):
        return
    from . import server
    from types import SimpleNamespace
    agent = session.get("agent")
    if agent is not None:
        model, runtime = runtime_for_session(sid)
        result = SimpleNamespace(new_model=model, target_provider="aino", **{
            k: runtime[k] for k in ("api_key", "base_url", "api_mode")},
            managed_metadata=managed_metadata(session["managed_model_params"]))
        try:
            with server._session_profile_runtime_scope(session):
                server._commit_agent_switch(sid, session, agent, result, agent.model, None)
        except Exception:
            get_registry().clear_session(sid)
            raise ManagedBindingError("managed_model_switch_failed") from None
        agent._fallback_chain = []
        agent._fallback_model = None
        agent._credential_pool = None
    session.pop("model_override", None)
    session.pop("resume_runtime_overrides", None)
    session.pop("managed_pending_switch", None)
    server._emit("session.info", sid, model_status(session, sid))
