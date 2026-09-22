"""Session-authorized semantic summaries without entering the chat turn loop."""
from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


@method("session.summary")
def _generate_session_summary_rpc(rid, params):
    from copy import deepcopy
    from dataclasses import replace
    from uuid import uuid4
    from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope
    from hermes_cli.web_session_summary import SummaryBusy, summary_for_db
    from tui_gateway.managed_model_runtime import ManagedBindingError
    from tui_gateway.managed_session import runtime_for_session, submit_refusal, transport_may_use_session

    sid = _str_param(params, "session_id")
    transport, session = _current_session_steer_authority(sid)
    if transport is None or session is None or not transport_may_use_session(session, transport):
        return _err(rid, 4001, "session not found or not owned by this transport")
    language = params.get("language", "zh")
    agent = session.get("agent")
    with _session_profile_runtime_scope(session), _session_db(session) as db:
        if db is None or not session.get("session_key"):
            return _err(rid, 4001, "session history is unavailable")
        def should_yield():
            ready = session.get("agent_ready")
            return bool(session.get("running") or (
                session.get("agent_build_started") and ready and not ready.is_set()))

        if should_yield():
            result = summary_for_db(db, session["session_key"], language)
            return _ok(rid, {**result, "busy": True, "error_code": "busy"})
        deferred_inputs = None
        if session.get("managed_model_params"):
            refusal = submit_refusal(sid, session)
            if refusal:
                return _err(rid, 4006, refusal)
            try:
                model, runtime = runtime_for_session(sid)
            except ManagedBindingError as exc:
                return _err(rid, 4006, str(exc))
            runtime["model"] = model
        elif agent is not None:
            runtime = {k: getattr(agent, k, None) for k in (
                "model", "provider", "base_url", "api_key", "api_mode", "requested_provider", "auth_mode")}
        else:
            # Resolve exactly what a deferred resume would build, without building an
            # agent, loading tools/prompts, or entering the conversation turn loop.
            kwargs = _deferred_build_agent_kwargs(session, db)
            deferred_inputs = deepcopy((kwargs.get("model_override"), kwargs.get("provider_override")))
            try:
                model, runtime = _resolve_agent_model_runtime(*deferred_inputs)
            except Exception:
                # The service only permits an explicit independent auxiliary route
                # without a main runtime; inherited auto returns runtime_required.
                runtime = None
            else:
                runtime["model"] = model

        if runtime is not None:
            runtime["session_id"] = session["session_key"]
        identity = tuple((runtime or {}).get(k) for k in ("model", "provider", "base_url", "api_mode"))

        def authority_check():
            peer, current = _current_session_steer_authority(sid)
            if peer is not transport or current is not session:
                raise RuntimeError("session summary authority changed")
            if should_yield():
                raise SummaryBusy()
            if not session.get("managed_model_params"):
                current_agent = session.get("agent")
                if current_agent is not agent:
                    raise RuntimeError("session summary model changed")
                if agent is not None:
                    current_identity = tuple(getattr(agent, k, None) for k in (
                        "model", "provider", "base_url", "api_mode"))
                    if identity != current_identity:
                        raise RuntimeError("session summary model changed")
                elif deferred_inputs is not None:
                    current_kwargs = _deferred_build_agent_kwargs(session, db)
                    if deferred_inputs != (current_kwargs.get("model_override"), current_kwargs.get("provider_override")):
                        raise RuntimeError("session summary model changed")

        key = (runtime or {}).get("api_key")
        scope = BillingScope("turn", None, session["session_key"], str(uuid4()), "session_summary")
        if isinstance(key, ManagedCredential):
            def authorized_key():
                authority_check()
                return key()
            runtime["api_key"] = replace(key, get_key=authorized_key)
            scope = BillingScope("aino", key.user_id, key.session_id, str(uuid4()), "session_summary")
        token = billing_scope.set(scope)
        try:
            result = summary_for_db(db, session["session_key"], language, generate=True,
                                    retry=params.get("retry", False), main_runtime=runtime,
                                    authority_check=authority_check, should_yield=should_yield)
        finally:
            billing_scope.reset(token)
        return _ok(rid, result)


def register(server):
    bind_module(globals(), server)
