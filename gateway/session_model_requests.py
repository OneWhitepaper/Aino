"""Credential-free native model discovery and conversation-scoped next-message selections.

The native account remains the catalog and credential authority. Terminal clients ask through
this owner's existing viewer bridge; a hosted member asks only its room's original viewer.
Selections are desired conversation metadata, never profile config or live-turn route edits.
"""
import asyncio
from copy import deepcopy
from dataclasses import dataclass
import json
from pathlib import Path
import threading
import time
import uuid

from gateway.owner_identity import same_owner
from hermes_state_runtime import RuntimeStoreError
from hermes_state_common import CONVERSATION_MODEL_SELECTION_KEY as _SELECTION_KEY
_TIMEOUT = 30
_MAX_MODELS = 2048
_MAX_LAZY_VIEWERS = 256
_LAZY_VIEWER_TIMEOUT = 120
_lock = threading.Lock()
_pending = {}


@dataclass
class _PendingModel:
    wire: dict
    grant: object
    peer: object
    future: object
    loop: object
    deadline: float


def register_group_model_viewer(grant, sid, transport):
    """Retain the room's narrow metadata viewer, independently of any managed credential grant."""
    from gateway.session_group_models import _validate
    _validate(grant)
    live = grant.target.sessions.get(sid)
    if live is not None:
        live.model_catalog_viewer = (grant, transport)
        return
    # A first external turn is born only when the existing producer submits it. Keep
    # this metadata-only association on that producer's service until its exact sid exists.
    service = grant.service
    with _lock:
        viewers = getattr(service, 'model_catalog_viewers', None)
        if viewers is None:
            viewers = service.model_catalog_viewers = {}
        now = time.monotonic()
        for key, entry in list(viewers.items()):
            if entry[2] <= now:
                del viewers[key]
        key = (grant.target.profile_id, sid)
        if key not in viewers and len(viewers) >= _MAX_LAZY_VIEWERS:
            viewers.pop(next(iter(viewers)))
        viewers[key] = (grant, transport, now + _LAZY_VIEWER_TIMEOUT)


def _group_viewer(authority, sid):
    from gateway.session_group_models import _validate
    live = authority.sessions[sid]
    viewer = getattr(live, 'model_catalog_viewer', None)
    if viewer is None:
        sources = (authority, *(getattr(authority.runner, 'session_authorities', ()) or ()))
        for source in sources:
            service = getattr(source, 'hosted_room_service', None)
            with _lock:
                viewers = getattr(service, 'model_catalog_viewers', {})
                pending = viewers.pop((authority.profile_id, sid), None)
            if pending is not None and pending[2] > time.monotonic():
                candidate, peer = pending[:2]
                _validate(candidate)
                viewer = live.model_catalog_viewer = (candidate, peer)
                break
    if viewer is None:
        grant = getattr(live, 'group_model_grant', None)
        state = getattr(live, 'managed_model_state', {})
        viewer = (grant, state.get('transport'))
    grant, peer = viewer
    if grant is None or grant.target is not authority or peer is None:
        raise RuntimeStoreError('managed_binding_forbidden')
    _validate(grant)
    return grant, peer


def _authorize(connection, ref):
    from gateway.session_policy import policy_for_source
    authority, actor = connection.authority, connection.actor
    if actor.profile_id != authority.profile_id or ref.profile_id != authority.profile_id:
        raise RuntimeStoreError('profile_mismatch')
    if 'session:control' not in actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    live = authority.sessions.get(ref.session_id)
    if live is None:
        raise RuntimeStoreError('not_found')
    policy = policy_for_source(authority.runner, live.source)
    if policy is None or policy.source not in {'gui', 'bot_room'}:
        raise RuntimeStoreError('managed_binding_forbidden')
    if policy.source == 'bot_room':
        grant, peer = _group_viewer(authority, ref.session_id)
        if not same_owner(grant.owner_subject, actor.subject):
            raise RuntimeStoreError('permission_denied')
        return live, (grant, peer)
    authority.authorize(actor, ref, 'session:control')
    return live, None


def _text(value, limit, *, optional=False):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise RuntimeStoreError('invalid_model_response')
    return value.strip()


def _row(raw):
    if not isinstance(raw, dict) or set(raw) - {'model_id', 'model_source', 'provider', 'name', 'owner'}:
        raise RuntimeStoreError('invalid_model_response')
    source = raw.get('model_source')
    if source not in {'aino', 'provider'}:
        raise RuntimeStoreError('invalid_model_response')
    row = {'model_id': _text(raw.get('model_id'), 256), 'model_source': source}
    for key, limit in (('provider', 128), ('name', 256)):
        if raw.get(key) is not None:
            row[key] = _text(raw[key], limit)
    if source == 'aino':
        from tui_gateway.methods_managed_model import _managed_owner
        from tui_gateway.managed_model_runtime import ManagedBindingError
        if not isinstance(raw.get('owner'), dict) or set(raw['owner']) != {'user_id', 'platform_origin'}:
            raise RuntimeStoreError('invalid_model_response')
        try:
            owner = _managed_owner({'owner': raw.get('owner')})
        except ManagedBindingError:
            raise RuntimeStoreError('invalid_model_response') from None
        row['owner'] = {'user_id': owner.user_id, 'platform_origin': owner.platform_origin}
        if row.get('provider', 'aino') != 'aino':
            raise RuntimeStoreError('invalid_model_response')
    elif not row.get('provider') or raw.get('owner') is not None:
        raise RuntimeStoreError('invalid_model_response')
    return row


def _answer(raw, action):
    if (not isinstance(raw, dict) or set(raw) - {'status', 'models', 'selection'}
            or raw.get('status') not in {'available', 'selected', 'not_found', 'ambiguous', 'unavailable'}):
        raise RuntimeStoreError('invalid_model_response')
    status = raw['status']
    if (action == 'list' and status == 'selected') or (action == 'select' and status == 'available'):
        raise RuntimeStoreError('invalid_model_response')
    result = {'status': status}
    if raw.get('models') is not None:
        if not isinstance(raw['models'], list) or len(raw['models']) > _MAX_MODELS:
            raise RuntimeStoreError('invalid_model_response')
        result['models'] = [_row(row) for row in raw['models']]
    if status == 'selected':
        result['selection'] = _row(raw.get('selection'))
    elif raw.get('selection') is not None:
        raise RuntimeStoreError('invalid_model_response')
    return result


def _scope(connection, group):
    scope = {'owner_subject': connection.actor.subject}
    if group is not None:
        grant, _peer = group
        scope.update(source_home=grant.source.profile_id, room_id=grant.room_id, member_id=grant.member_id,
                     profile=grant.profile, room_authority=list(grant.room_authority),
                     host_scoped=grant.host_scoped, owner_subject=grant.owner_subject)
    return scope


def _validate_saved_scope(authority, scope):
    if not isinstance(scope, dict) or not scope.get('owner_subject'):
        raise RuntimeStoreError('managed_binding_forbidden')
    if 'room_id' not in scope:
        return
    from gateway.session_group_models import _member
    sources = (authority, *(getattr(authority.runner, 'session_authorities', ()) or ()))
    source = next((item for item in sources if item.profile_id == scope.get('source_home')), None)
    service = getattr(source, 'hosted_room_service', None)
    if source is None or service is None:
        raise RuntimeStoreError('managed_binding_forbidden')
    target, profile, owner, room_authority = _member(
        source, service, scope['room_id'], scope['member_id'], host_scoped=scope.get('host_scoped') is True)
    if (target is not authority or profile != scope.get('profile')
            or not same_owner(scope['owner_subject'], owner)
            or list(room_authority) != scope.get('room_authority')):
        raise RuntimeStoreError('managed_binding_forbidden')


def _saved_selection(authority, sid):
    from gateway.session_ancillary import physical_target
    from gateway.session_contract import SessionRef
    target = physical_target(authority, SessionRef(authority.profile_id, sid))
    with authority.db._read_ctx() as conn:
        found = conn.execute('SELECT model_config FROM sessions WHERE id=?', (target,)).fetchone()
    raw = json.loads(found[0] or '{}').get(_SELECTION_KEY) if found else None
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {'scope', 'selection'}:
        raise RuntimeStoreError('managed_binding_forbidden')
    _validate_saved_scope(authority, raw['scope'])
    return raw


def selection_for_session(authority, sid):
    """The desired conversation selection, or None; stale room scope refuses instead of falling back."""
    saved = _saved_selection(authority, sid)
    return _row(saved['selection']) if saved is not None else None


def _selection_fence(authority, sid):
    from hermes_state_mutation_prepared import DEFERRED_PICK_PREFIX
    with authority.db._read_ctx() as conn:
        row = conn.execute('SELECT runtime_revision, runtime_generation FROM sessions WHERE id=?', (sid,)).fetchone()
        deferred = conn.execute('SELECT value FROM state_meta WHERE key=?', (DEFERRED_PICK_PREFIX + sid,)).fetchone()
    if row is None:
        raise RuntimeStoreError('not_found')
    return row[0], row[1], deferred[0] if deferred else None


def _save_selection(authority, sid, selection, scope, fence):
    from hermes_state_runtime import _epoch
    value = {'scope': scope, 'selection': selection}

    def write(conn):
        _epoch(conn, authority.epoch)
        from hermes_state_mutation_prepared import DEFERRED_PICK_PREFIX
        row = conn.execute('SELECT runtime_revision, runtime_generation FROM sessions WHERE id=?', (sid,)).fetchone()
        deferred = conn.execute('SELECT value FROM state_meta WHERE key=?', (DEFERRED_PICK_PREFIX + sid,)).fetchone()
        current = (row[0], row[1], deferred[0] if deferred else None) if row else None
        if current != fence:
            raise RuntimeStoreError('model_request_expired')
        target = authority.db._compression_tip_on(conn, sid)
        found = conn.execute('SELECT model_config FROM sessions WHERE id=?', (target,)).fetchone()
        if found is None:
            raise RuntimeStoreError('not_found')
        config = json.loads(found[0] or '{}')
        config[_SELECTION_KEY] = value
        conn.execute('UPDATE sessions SET model_config=? WHERE id=?', (json.dumps(config), target))
    authority.db._execute_write(write)


def _still_current(connection, ref, live, generation, group=None):
    try:
        current, active_group = _authorize(connection, ref)
        if group is not None and (active_group is None or active_group[0] != group[0] or active_group[1] is not group[1]):
            return False
        authority = connection.authority
        stopped = (authority.pending_stops.get(ref.session_id) == generation
                   or authority.delivered_stops.get(ref.session_id) == generation)
        return (current is live and authority._handle(ref).execution_generation == generation and not stopped
                and authority.events.get(connection.actor.transport_id) is connection.transport)
    except RuntimeStoreError:
        return False


async def _ask_group(wire, group, cancelled):
    grant, peer = group
    loop = asyncio.get_running_loop()
    pending = _PendingModel(wire, grant, peer, loop.create_future(), loop, time.monotonic() + _TIMEOUT)
    with _lock:
        _pending[wire['request_id']] = pending
    try:
        while not cancelled():
            remaining = pending.deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                return await asyncio.wait_for(asyncio.shield(pending.future), timeout=min(0.25, remaining))
            except TimeoutError:
                continue
        return None
    finally:
        with _lock:
            _pending.pop(wire['request_id'], None)


def _finish_pending(pending, result):
    def settle():
        if not pending.future.done():
            pending.future.set_result(result)
    pending.loop.call_soon_threadsafe(settle)


def model_requests_for_room(connection, room_id):
    """Only the exact live renderer selected by the room preparation receives requests to answer."""
    from gateway.session_group_models import _validate
    with _lock:
        candidates = list(_pending.values())
    found = []
    for pending in candidates:
        grant = pending.grant
        if grant.source is not connection.authority or grant.room_id != room_id:
            continue
        try:
            _validate(grant)
        except RuntimeStoreError:
            _finish_pending(pending, None)
            continue
        if pending.deadline <= time.monotonic():
            _finish_pending(pending, None)
        elif (connection.transport is pending.peer and same_owner(grant.owner_subject, connection.actor.subject)):
            found.append(deepcopy(pending.wire))
    return found


async def respond_group_model(connection, params):
    from gateway.session_group_models import _validate
    from tui_gateway.managed_model_runtime import transport_principal
    with _lock:
        pending = _pending.get(params.get('request_id'))
    if pending is None:
        return {'accepted': False}
    grant = pending.grant
    if (grant.source is not connection.authority or grant.room_id != params.get('room_id')
            or connection.transport is not pending.peer
            or not same_owner(grant.owner_subject, connection.actor.subject)
            or transport_principal(connection.transport) != grant.transport_identity):
        raise RuntimeStoreError('permission_denied')
    try:
        if pending.deadline <= time.monotonic():
            raise RuntimeStoreError('model_request_expired')
        await asyncio.to_thread(_validate, grant)
        result = _answer(params.get('result'), pending.wire['action'])
    except RuntimeStoreError:
        _finish_pending(pending, None)
        raise
    _finish_pending(pending, result)
    return {'accepted': True}


async def model_session(connection, ref, params):
    if (set(params) - {'session_id', 'action', 'query', 'provider'}
            or params.get('session_id') != ref.session_id or not isinstance(ref.session_id, str) or not ref.session_id
            or params.get('action') not in {'list', 'select', 'selection'}):
        raise RuntimeStoreError('invalid_params')
    action = params['action']
    for key, limit in (('query', 256), ('provider', 128)):
        if key in params and (not isinstance(params[key], str) or not params[key].strip() or len(params[key]) > limit):
            raise RuntimeStoreError('invalid_params')
    if (action == 'select' and not params.get('query')) or (action == 'selection' and set(params) != {'session_id', 'action'}):
        raise RuntimeStoreError('invalid_params')
    if ref.session_id not in connection.authority.sessions:
        from dataclasses import replace
        from hermes_state_local import local_lineage_owner
        with connection.authority.db._read_ctx() as conn:
            owner = local_lineage_owner(conn, ref.session_id)
        if owner != ref.session_id:
            ref = replace(ref, session_id=owner)
    live, group = _authorize(connection, ref)
    authority = connection.authority
    if action == 'selection':
        saved = await asyncio.to_thread(_saved_selection, authority, ref.session_id)
        if saved is not None and not same_owner(saved['scope']['owner_subject'], connection.actor.subject):
            raise RuntimeStoreError('permission_denied')
        return {'selection': _row(saved['selection']) if saved else None}
    if getattr(live, 'model_catalog_request', None) is not None:
        raise RuntimeStoreError('session_busy')
    from gateway.session_authorities import served_profile_name
    wire = {'request_id': uuid.uuid4().hex, 'session_id': ref.session_id,
            'profile': served_profile_name(Path(authority.profile_id)), 'action': action,
            **{key: params[key] for key in ('query', 'provider') if key in params}}
    if group is not None:
        wire.update(room_id=group[0].room_id, member_id=group[0].member_id)
    live.model_catalog_request = wire['request_id']
    try:
        fence = await asyncio.to_thread(_selection_fence, authority, ref.session_id)
        generation = fence[1]
        if group is None:
            from gateway.session_server_requests import ask_viewer_result
            raw = await asyncio.to_thread(ask_viewer_result, live.event_stream, ref.session_id, 'model.session', wire,
                timeout=_TIMEOUT, cancelled=lambda: not _still_current(connection, ref, live, generation, group))
        else:
            raw = await _ask_group(wire, group, lambda: not _still_current(connection, ref, live, generation, group))
        if raw is None:
            return {'status': 'unavailable'}
        if not _still_current(connection, ref, live, generation, group):
            raise RuntimeStoreError('model_request_expired')
        result = _answer(raw, action)
        if result['status'] == 'selected':
            async with live.mutation_lock:
                if not _still_current(connection, ref, live, generation, group):
                    raise RuntimeStoreError('model_request_expired')
                await asyncio.to_thread(_save_selection, authority, ref.session_id, result['selection'],
                                        _scope(connection, group), fence)
            if not _still_current(connection, ref, live, generation, group):
                raise RuntimeStoreError('model_request_expired')
            return {'status': 'scheduled', 'effective': 'next_message', 'selection': result['selection']}
        return result
    finally:
        if getattr(live, 'model_catalog_request', None) == wire['request_id']:
            live.model_catalog_request = None
