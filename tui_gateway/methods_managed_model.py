"""Narrow delegation from the owning chat socket to a main-process socket."""

from datetime import datetime, UTC
from urllib.parse import urlsplit

from pathlib import Path
from .managed_model_runtime import (
    ManagedBindingError, ManagedModelBinding, ManagedModelOwner, get_registry, transport_principal,
)

_handlers = {}


def _managed_text(params, name, limit=256):
    value = params.get(name)
    if not isinstance(value, str) or not value or len(value) > limit:
        raise ManagedBindingError("managed_binding_invalid")
    return value


def _managed_owner(params):
    value = params.get("owner")
    if not isinstance(value, dict):
        raise ManagedBindingError("managed_binding_invalid")
    origin = _managed_text(value, "platform_origin", 2048)
    url = urlsplit(origin)
    if (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment
            or (url.scheme == "http" and url.hostname not in {"127.0.0.1", "::1", "localhost"})):
        raise ManagedBindingError("managed_binding_invalid")
    return ManagedModelOwner(origin, _managed_text(value, "user_id"))


def _managed_method(name):
    def decorate(fn):
        def handler(rid, params):
            from . import server as srv
            try:
                sid = _managed_text(params, "session_id")
                peer = srv.current_transport()
                if peer is None:
                    raise ManagedBindingError("managed_binding_forbidden")
                transport_principal(peer)
                with srv._sessions_lock:
                    session = srv._sessions.get(sid)
                    if not session or session.get("_closing") or srv._session_source(session) != "desktop":
                        raise ManagedBindingError("managed_binding_forbidden")
                    profile = params.get("profile") or "default"
                    if not isinstance(profile, str) or len(profile) > 256:
                        raise ManagedBindingError("managed_binding_invalid")
                    requested_home = srv._profile_home(None if profile == "default" else profile)
                    from hermes_constants import get_hermes_home
                    expected_home = Path(requested_home or get_hermes_home()).resolve()
                    if Path(session.get("profile_home") or get_hermes_home()).resolve() != expected_home:
                        raise ManagedBindingError("managed_binding_forbidden")
                    return srv._ok(rid, fn(params, sid, session, peer))
            except (ManagedBindingError, ValueError, TypeError, OverflowError, FileNotFoundError):
                # Never echo params, credential material, URLs or raw exceptions.
                return srv._err(rid, 4403, "managed model binding rejected",
                            {"reason": "managed_binding_rejected"})
        _handlers[name] = handler
        return handler
    return decorate


@_managed_method("session.managed_model_ticket")
def _managed_model_ticket(params, sid, session, peer):
    if session.get("transport") is not peer:
        raise ManagedBindingError("managed_binding_forbidden")
    owner, model_id = _managed_owner(params), _managed_text(params, "model_id", 128)
    ticket = get_registry().issue(sid, session, peer, owner, model_id)
    return {"session_ticket": ticket, "managed_model_binding": 1}


@_managed_method("session.claim_managed_model")
def _claim_managed_model(params, sid, session, peer):
    revision = get_registry().claim(sid, session, peer, _managed_text(params, "session_ticket"),
                                   _managed_owner(params), _managed_text(params, "model_id", 128))
    return {"binding_revision": revision, "managed_model_binding": 1, "managed_model_context_window": True}


def _binding(params, sid):
    owner = _managed_owner(params)
    expires = datetime.fromisoformat(_managed_text(params, "expires_at"))
    if expires.tzinfo is None or expires <= datetime.now(UTC):
        raise ManagedBindingError("managed_binding_expired")
    revision = params.get("binding_revision")
    if type(revision) is not int or revision <= 0:
        raise ManagedBindingError("managed_binding_invalid")
    mode = _managed_text(params, "api_mode")
    capabilities = params.get("capabilities")
    context_window = params.get("context_window")
    if context_window is not None and (type(context_window) is not int or context_window <= 0):
        raise ManagedBindingError("managed_binding_invalid")
    if (mode not in {"chat_completions", "responses", "anthropic_messages"}
            or not isinstance(capabilities, dict) or capabilities.get("tools") is not True
            or any(type(capabilities.get(k)) is not bool for k in ("tools", "vision", "reasoning"))
            or _managed_text(params, "base_url", 2048) != owner.platform_origin + "/v1"):
        raise ManagedBindingError("managed_binding_invalid")
    return ManagedModelBinding(
        session_id=sid, owner=owner, model_id=_managed_text(params, "model_id", 128),
        model=_managed_text(params, "model", 256), api_mode=mode, capabilities=dict(capabilities),
        credential_id=_managed_text(params, "credential_id"), api_key=_managed_text(params, "api_key", 4096),
        base_url=params["base_url"], expires_at=expires, binding_revision=revision,
        context_window=context_window)


@_managed_method("session.bind_managed_model")
def _bind_managed_model(params, sid, session, peer):
    binding = _binding(params, sid)
    get_registry().bind(binding, session, peer)
    from .managed_session import apply_bound_selection, sync_bound_context
    apply_bound_selection(sid, session)
    sync_bound_context(sid, session)
    return {"bound": True, "model_id": binding.model_id, "binding_revision": binding.binding_revision}


@_managed_method("session.renew_managed_model")
def _renew_managed_model(params, sid, session, peer):
    binding = _binding(params, sid)
    get_registry().renew(binding, session, peer)
    from .managed_session import sync_bound_context
    sync_bound_context(sid, session)
    return {"bound": True, "model_id": binding.model_id, "binding_revision": binding.binding_revision}


@_managed_method("session.clear_managed_model")
def _clear_managed_model(params, sid, session, peer):
    revision = params.get("binding_revision")
    if type(revision) is not int or revision <= 0:
        raise ManagedBindingError("managed_binding_invalid")
    return {"cleared": get_registry().clear(sid, revision, peer)}


def register(server):
    for name, handler in _handlers.items():
        server.register_method(name, handler)
