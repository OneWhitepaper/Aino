"""Transport-delegated model authority; secrets are never persisted with sessions."""

from dataclasses import dataclass, field
from datetime import datetime, UTC
import secrets
import threading
import time


class ManagedBindingError(ValueError):
    pass


@dataclass(frozen=True)
class ManagedModelOwner:
    platform_origin: str
    user_id: str


@dataclass(frozen=True)
class ManagedModelBinding:
    session_id: str
    owner: ManagedModelOwner
    model_id: str
    model: str
    api_mode: str
    capabilities: dict
    credential_id: str
    api_key: str = field(repr=False)
    base_url: str
    expires_at: datetime | None
    binding_revision: int
    context_window: int | None = None
    purpose: str = 'chat'
    credential_type: str = 'lease'
    credential_version: int | None = None


@dataclass
class _Authority:
    session: dict = field(repr=False)
    peer: object = field(repr=False)
    owner: ManagedModelOwner
    model_id: str
    revision: int
    ticket: str = field(repr=False)
    deadline: float
    controller: object = field(default=None, repr=False)
    binding: ManagedModelBinding | None = field(default=None, repr=False)
    timer: threading.Timer | None = field(default=None, repr=False)


def transport_principal(transport):
    identity = getattr(transport, "auth_identity", None)
    if isinstance(identity, dict):
        if identity.get("read_only") or identity.get("role") in {"viewer", "read_only"}:
            raise ManagedBindingError("managed_binding_forbidden")
        scopes = identity.get("scopes")
        if scopes is not None and (not isinstance(scopes, (list, tuple, set))
                                   or not all(isinstance(scope, str) for scope in scopes)
                                   or not ({"write", "session:write", "*"} & set(scopes))):
            raise ManagedBindingError("managed_binding_forbidden")
        if not identity.get("user_id") or not identity.get("provider"):
            raise ManagedBindingError("managed_binding_forbidden")
        return identity["provider"], identity["user_id"]
    # Legacy token-auth WS peers have no identity payload. Their exact session
    # transport issues a one-time capability; a public session id never suffices.
    return None


def _interrupt(binding, session):
    if not binding or binding.purpose == 'image':
        return
    if interrupt := session.get("_interrupt_managed"):
        interrupt()
        return
    if not session.get("running"):
        return
    from . import server
    with server._sessions_lock:
        if server._sessions.get(binding.session_id) is not session:
            return
        with get_registry()._lock:
            current = get_registry()._active.get((binding.session_id, binding.purpose))
            if current and current.revision != binding.binding_revision:
                return
        server._interrupt_session_turn(binding.session_id, session)


def resolve_managed_runtime(binding: ManagedModelBinding, *, now: float) -> dict:
    """Resolve a lease at a Unix timestamp, without consulting ambient credentials."""
    if binding.expires_at is not None and binding.expires_at.timestamp() <= now:
        return {"credential_expired": True}
    modes = {"chat_completions": "chat_completions", "anthropic_messages": "anthropic_messages",
             "responses": "codex_responses"}
    if binding.api_mode not in modes:
        raise ManagedBindingError("managed_model_protocol_unsupported")

    return {
        "provider": "aino",
        "model": binding.model,
        "base_url": binding.base_url,
        "api_key": binding.api_key,
        "api_mode": modes[binding.api_mode],
    }


def persisted_managed_model_metadata(binding: ManagedModelBinding) -> dict:
    """Return only source/owner/model/protocol identifiers, never credentials.

    This is stored in session DB for history recovery. Credentials are never persisted.

    Returns:
        Dict with model_source='aino', platform_owner, model_id, and api_mode
    """
    return {
        "model_source": "aino",
        "platform_owner": {
            "platform_origin": binding.owner.platform_origin,
            "user_id": binding.owner.user_id,
        },
        "model_id": binding.model_id,
        "model": binding.model,
        "api_mode": binding.api_mode,
    }


class ManagedModelRegistry:
    def __init__(self):
        self._lock = threading.RLock()
        self._pending: dict[tuple[str, str], _Authority] = {}
        self._active: dict[tuple[str, str], _Authority] = {}
        self._revision = 0

    @staticmethod
    def _cancel(a):
        if a and a.timer:
            a.timer.cancel()

    @staticmethod
    def _key(sid, purpose):
        if purpose not in {'chat', 'image'}:
            raise ManagedBindingError('managed_binding_invalid')
        return sid, purpose

    @staticmethod
    def _validate_selection(session, owner, model_id, purpose):
        from .managed_session import validate_selection
        if purpose == 'chat':
            validate_selection(session, owner, model_id)
            return
        selected = session.get('managed_image_params')
        if (not selected or selected.get('model_id') != model_id
                or (selected.get('platform_owner') and selected['platform_owner'] != {
                    'platform_origin': owner.platform_origin, 'user_id': owner.user_id})):
            raise ManagedBindingError('managed_model_identity_mismatch')

    def issue(self, sid, session, peer, owner, model_id, *, purpose='chat'):
        key = self._key(sid, purpose)
        with self._lock:
            selected = session.get('managed_image_params') or {}
            requested_owner = {'platform_origin': owner.platform_origin, 'user_id': owner.user_id}
            if (purpose == 'image' and selected.get('model_id') == model_id
                    and selected.get('platform_owner') not in (None, requested_owner)
                    and peer is session.get('transport') and not session.get('_closing')
                    and not session.get('running') and self.get(sid, session, purpose='image') is None):
                # Image metadata is ephemeral. Only a fresh owning ticket may change accounts,
                # after the previous lease and turn ended; its revision retires every old ticket.
                session['managed_image_params'] = {'model_id': model_id, 'platform_owner': requested_owner}
            self._validate_selection(session, owner, model_id, purpose)
            self._revision += 1
            self._cancel(self._pending.pop(key, None))
            # Renewing a lease must not interrupt the current turn or mutate
            # its prompt/history. Keep the active lease until replacement.
            a = _Authority(session, peer, owner, model_id, self._revision,
                           secrets.token_urlsafe(32), time.monotonic() + 60)
            self._pending[key] = a
            a.timer = threading.Timer(60, self._expire_pending, args=(key, a))
            a.timer.daemon = True
            a.timer.start()
            return a.ticket

    def _expire_pending(self, sid, a):
        with self._lock:
            if self._pending.get(sid) is a:
                self._pending.pop(sid)

    def claim(self, sid, session, peer, ticket, owner, model_id, *, purpose='chat'):
        key = self._key(sid, purpose)
        with self._lock:
            a = self._pending.get(key)
            if (not a or a.session is not session or a.peer is not session.get("transport")
                    or session.get("_closing") or a.deadline <= time.monotonic()
                    or not a.ticket or not secrets.compare_digest(a.ticket, ticket)
                    or a.owner != owner or a.model_id != model_id
                    or transport_principal(a.peer) != transport_principal(peer)):
                raise ManagedBindingError("managed_binding_forbidden")
            a.ticket = ""
            a.controller = peer
            return a.revision

    def bind(self, binding, session, peer):
        key = self._key(binding.session_id, binding.purpose)
        with self._lock:
            a = self._pending.get(key)
            if (not a or a.session is not session or a.peer is not session.get("transport")
                    or session.get("_closing") or a.controller is not peer
                    or a.deadline <= time.monotonic()
                    or binding.binding_revision != a.revision or binding.owner != a.owner
                    or binding.model_id != a.model_id):
                raise ManagedBindingError("managed_binding_stale")
            permanent = binding.credential_type == 'device' and binding.expires_at is None
            version = binding.credential_version
            if ((binding.credential_type == 'device' and (type(version) is not int or version <= 0))
                    or (binding.credential_type == 'lease' and version is not None)):
                raise ManagedBindingError('managed_binding_invalid')
            seconds = None if permanent else (
                (binding.expires_at - datetime.now(UTC)).total_seconds() if binding.expires_at else 0)
            if binding.credential_type not in {'device', 'lease'} or (not permanent and not 0 < seconds <= 3605):
                raise ManagedBindingError("managed_binding_expired")
            previous = self._active.get(key)
            if binding.purpose == 'chat' and session.get("running") and (not previous or
                    previous.owner != a.owner or previous.model_id != a.model_id):
                raise ManagedBindingError("managed_binding_busy")
            self._validate_runtime(binding, session)
            self._cancel(previous)
            self._cancel(a)
            self._pending.pop(key)
            a.binding = binding
            a.timer = None
            self._active[key] = a
            if seconds is not None:
                a.timer = threading.Timer(seconds, self._expire, args=(key, a))
                a.timer.daemon = True
                a.timer.start()

    @staticmethod
    def _validate_runtime(binding, session):
        ManagedModelRegistry._validate_selection(session, binding.owner, binding.model_id, binding.purpose)
        field = 'managed_image_params' if binding.purpose == 'image' else 'managed_model_params'
        selected = session.get(field)
        if selected:
            if any(selected.get(k) and selected[k] != getattr(binding, k) for k in ("model", "api_mode")):
                raise ManagedBindingError("managed_model_identity_mismatch")
            session[field] = persisted_managed_model_metadata(binding)

    def renew(self, binding, session, peer):
        """An existing controller may extend ONLY its still-live, exact runtime."""
        key = self._key(binding.session_id, binding.purpose)
        with self._lock:
            a = self._active.get(key)
            now = datetime.now(UTC)
            if (not a or a.session is not session or a.peer is not session.get("transport")
                    or session.get("_closing") or a.controller is not peer
                    or a.revision != binding.binding_revision
                    or binding.credential_type != 'lease' or a.binding.credential_type != 'lease'
                    or a.binding.expires_at is None or binding.expires_at is None
                    or a.binding.expires_at <= now
                    or any(getattr(a.binding, k) != getattr(binding, k) for k in
                           ("owner", "model_id", "model", "api_mode", "base_url", "capabilities"))
                    or not 0 < (binding.expires_at - now).total_seconds() <= 3605
                    or binding.expires_at < a.binding.expires_at):
                raise ManagedBindingError("managed_binding_stale")
            self._validate_runtime(binding, session)
            self._cancel(a)
            # Replace authority so an expiry callback already queued for the old
            # lease cannot invalidate the renewed one.
            replacement = _Authority(session, a.peer, a.owner, a.model_id, a.revision, "", a.deadline,
                                     controller=peer, binding=binding)
            self._active[key] = replacement
            replacement.timer = threading.Timer((binding.expires_at - now).total_seconds(), self._expire,
                                                args=(key, replacement))
            replacement.timer.daemon = True
            replacement.timer.start()

    def _expire(self, sid, a):
        with self._lock:
            if self._active.get(sid) is not a:
                return
            self._active.pop(sid)
        # Never call session/agent code holding the registry lock.
        _interrupt(a.binding, a.session)

    def get(self, session_id, session=None, *, purpose='chat'):
        key = self._key(session_id, purpose)
        expired = None
        with self._lock:
            a = self._active.get(key)
            if not a:
                return None
            if (a.session.get("_closing") or a.peer is not a.session.get("transport")
                    or (session is not None and session is not a.session)
                    or (a.binding.expires_at is not None and a.binding.expires_at <= datetime.now(UTC))):
                expired = self._active.pop(key)
                self._cancel(expired)
            else:
                return a.binding
        _interrupt(expired.binding, expired.session)
        return None

    def reusable(self, sid, session, peer, owner, model_id, revision, credential_version, *, purpose='chat'):
        """Confirm this controller still owns the exact permanent binding without mutating it."""
        key = self._key(sid, purpose)
        if (type(revision) is not int or revision <= 0
                or type(credential_version) is not int or credential_version <= 0):
            raise ManagedBindingError('managed_binding_invalid')
        with self._lock:
            selection = session.get('managed_image_params' if purpose == 'image' else 'managed_model_params')
            a = self._active.get(key)
            if (not selection or key in self._pending or not a or a.session is not session
                    or a.peer is not session.get('transport')
                    or session.get('_closing') or a.controller is not peer
                    or a.owner != owner or a.model_id != model_id or a.revision != revision
                    or (purpose == 'chat' and session.get('managed_pending_switch'))):
                return False
            binding = a.binding
            if (binding is None or binding.credential_type != 'device' or binding.expires_at is not None
                    or binding.credential_version != credential_version):
                return False
            try:
                if transport_principal(a.peer) != transport_principal(peer):
                    return False
                self._validate_selection(session, owner, model_id, purpose)
            except ManagedBindingError:
                return False
            return True

    def clear(self, session_id, binding_revision, peer, *, purpose='chat'):
        key = self._key(session_id, purpose)
        removed = []
        with self._lock:
            for pool in (self._pending, self._active):
                a = pool.get(key)
                if not a or a.revision != binding_revision:
                    continue
                if peer is not a.controller and peer is not a.peer:
                    raise ManagedBindingError("managed_binding_forbidden")
                removed.append(pool.pop(key))
                self._cancel(a)
        for a in removed:
            _interrupt(a.binding, a.session)
        return bool(removed)

    def clear_session(self, session_id, *, purpose=None):
        with self._lock:
            for pool in (self._pending, self._active):
                for key in list(pool):
                    if key[0] == session_id and (purpose is None or key[1] == purpose):
                        self._cancel(pool.pop(key))

    def detach_transport(self, peer):
        removed = []
        with self._lock:
            for pool in (self._pending, self._active):
                for sid, a in list(pool.items()):
                    if peer is a.peer or peer is a.controller:
                        removed.append(pool.pop(sid))
                        self._cancel(a)
        return removed

    @staticmethod
    def interrupt_detached(removed):
        for a in removed:
            _interrupt(a.binding, a.session)

    def disconnect(self, peer):
        self.interrupt_detached(self.detach_transport(peer))


_managed_model_registry = ManagedModelRegistry()


def get_registry():
    return _managed_model_registry
