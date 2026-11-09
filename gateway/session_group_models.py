"""Current room ownership delegates one member's ephemeral Aino model binding.

The hosted producer still owns the FIFO and deterministic session identity. This grant only
lets the owner's native controller claim the ticket issued by its renderer; it grants no
session attach, history, submission or general mutation permission on a sibling profile.
"""
import asyncio
from dataclasses import asdict, dataclass, replace
from functools import partial
from pathlib import Path

from gateway.owner_identity import same_owner
from hermes_state_runtime import RuntimeStoreError
from tui_gateway.managed_model_runtime import ManagedBindingError, get_registry, transport_principal


@dataclass(frozen=True)
class GroupModelGrant:
    source: object
    service: object
    target: object
    source_epoch: int
    room_id: str
    member_id: str
    profile: str
    owner_subject: str
    room_authority: tuple
    caller_subject: str
    transport_identity: tuple | None
    host_scoped: bool
    model_owner: object


def _member(source, service, room_id, member_id, *, host_scoped):
    from gateway.session_authorities import local_bots
    if (getattr(source, 'hosted_room_service', None) is not service
            or getattr(source, 'retiring', False) or getattr(source, 'retired', False)):
        raise RuntimeStoreError('managed_binding_forbidden')
    status = service.runtime.status()
    if not status.get('running') or status.get('stopping'):
        raise RuntimeStoreError('runtime_coordination_required')
    room_authority = service._owned_authority(room_id)
    room = service._room(room_id)
    member = next((m for m in room['members'] if m.get('member_id') == member_id), None)
    if member is None:
        raise RuntimeStoreError('permission_denied')
    target = member.get('target')
    if target is not None and (not isinstance(target, dict) or target.get('kind', 'local') != 'local'):
        raise RuntimeStoreError('permission_denied')
    profile = member['profile']
    home = service.profile_homes().get(profile)
    bot = next((b for b in local_bots(source.runner) if b.name == profile
                and b.home == home and b.problem is None and not b.retiring
                and not getattr(b.authority, 'retired', False)), None)
    if bot is None or (bot.authority is not source and not host_scoped):
        raise RuntimeStoreError('permission_denied')
    if Path(bot.authority.db.db_path).resolve().parent != bot.home.resolve():
        raise RuntimeStoreError('profile_mismatch')
    return bot.authority, profile, service._owner(room_id), room_authority


def _validate(grant):
    from gateway.hosted_rooms import HostedRoomError
    try:
        current = _member(grant.source, grant.service, grant.room_id, grant.member_id,
                          host_scoped=grant.host_scoped)
        expected = grant.target, grant.profile, grant.owner_subject, grant.room_authority
        if (current != expected or grant.source.epoch != grant.source_epoch
                or not same_owner(grant.owner_subject, grant.caller_subject)):
            raise RuntimeStoreError('managed_binding_forbidden')
    except (HostedRoomError, RuntimeStoreError):
        raise RuntimeStoreError('managed_binding_forbidden') from None


def require_group_grant(authority, sid, *, connection=None):
    """Revalidate the ephemeral delegation for every model action and runtime credential read."""
    live = authority.sessions.get(sid)
    grant = getattr(live, 'group_model_grant', None)
    try:
        if grant is None or grant.target is not authority:
            raise RuntimeStoreError('managed_binding_forbidden')
        _validate(grant)
    except (RuntimeStoreError, ManagedBindingError):
        from gateway.session_platform_model import binding_key
        get_registry().clear_session(binding_key(authority, sid), purpose='chat')
        raise RuntimeStoreError('managed_binding_forbidden') from None
    if connection is not None and (
            'session:control' not in connection.actor.capabilities
            or connection.actor.profile_id != authority.profile_id
            or not same_owner(grant.owner_subject, connection.actor.subject)
            or (grant.target is not grant.source and not connection.host_scoped)
            or transport_principal(connection.transport) != grant.transport_identity):
        raise RuntimeStoreError('managed_binding_forbidden')
    return grant


def _grant(connection, params, owner):
    from tui_gateway.methods_managed_model import _managed_text
    room_id, member_id = (_managed_text(params, key, 128) for key in ('room_id', 'member_id'))
    service = getattr(connection.authority, 'hosted_room_service', None)
    if service is None:
        raise RuntimeStoreError('runtime_coordination_required')
    target, profile, subject, room_authority = _member(
        connection.authority, service, room_id, member_id, host_scoped=connection.host_scoped)
    if not same_owner(subject, connection.actor.subject):
        raise RuntimeStoreError('permission_denied')
    identity = transport_principal(connection.transport)
    if owner is not None and identity is None:
        raise RuntimeStoreError('managed_binding_forbidden')
    return GroupModelGrant(connection.authority, service, target, connection.authority.epoch,
                           room_id, member_id, profile, subject, room_authority,
                           connection.actor.subject, identity, connection.host_scoped, owner)


def _rpc(grant):
    from gateway.session_contract import SessionActor
    from gateway.session_hosted_rpc import HostedRoomAuthorityRPC
    from gateway.session_hosted_transport import _CAPS, _principal
    if grant.source is grant.target:
        principal = SessionActor(grant.owner_subject, grant.target.profile_id, _CAPS,
                              'hosted:' + grant.room_id + ':' + grant.member_id)
    else:
        principal = _principal(grant.target, {'source_home': grant.source.profile_id,
                                             'owner': grant.owner_subject})

    def authorize(*_args):
        _validate(grant)
        return True
    return HostedRoomAuthorityRPC(grant.target, asyncio.get_running_loop(), room_id=grant.room_id,
                                  member_id=grant.member_id, profile=grant.profile,
                                  principal=principal, authorize=authorize)


def _select(grant, sid, model_id, *, changed_owner):
    from gateway.session_mutation_model import managed_policy
    from gateway.session_platform_model import selection_for_policy
    from gateway.session_policy import restore_policy
    from hermes_state_local import POLICY_PREFIX
    from hermes_state_mutation_prepared import local_snapshot, model_in_transaction
    from hermes_state_runtime import _epoch
    import json
    authority = grant.target

    def write(conn):
        _epoch(conn, authority.epoch)
        # Source ownership is rechecked before AND after this off-loop write, before
        # publishing any credential grant. Never take another home's lock while holding
        # this writer: reciprocal room preparations must not invert their DB locks.
        raw = conn.execute('SELECT value FROM state_meta WHERE key=?', (POLICY_PREFIX + sid,)).fetchone()
        if raw is None:
            raise RuntimeStoreError('not_found')
        old = restore_policy(json.loads(raw[0])['policy'])
        if old.source != 'bot_room':
            raise RuntimeStoreError('managed_binding_forbidden')
        selected = selection_for_policy(old)
        if model_id is None and selected is None and old.follows_profile:
            return False
        if model_id is not None and selected == {'model_source': 'aino', 'model_id': model_id} and not changed_owner:
            return False
        snapshot = local_snapshot(authority.db, conn, sid)
        policy = (_following_policy(authority, old, sid) if model_id is None
                  else managed_policy(authority, old, sid, model_id))
        prepared = {'snapshot': snapshot, 'policy': asdict(policy)}
        model_in_transaction(authority.db, conn, sid, {}, prepared)
        return True
    return authority.db._execute_write(write)


def _following_policy(authority, old, sid):
    import json
    from gateway.session_policy import FOLLOW_ADOPTED, bind_launch_key
    from gateway.session_policy_credentials import recover_config_secrets
    frozen = old.config()
    # The immutable creation request stays intact. This existing adoption marker makes
    # the next turn read its own profile's entire route, including its own credentials.
    frozen.update({FOLLOW_ADOPTED: True, 'model': {'provider': ''}})
    policy = replace(old, model=None, config_json=json.dumps(frozen), credential_ref=None)
    secrets = recover_config_secrets(authority, old, skip={'model', 'providers', 'custom_providers'}) \
        if old.config_secret_ref else {}
    return bind_launch_key(authority, sid, policy, None, config_secrets=secrets)


def _following_result(grant, sid):
    return {'profile': grant.profile, 'session_id': sid, 'follow_profile_config': True}


async def _prepare(connection, grant, model_id):
    from gateway.session_authorities import async_owner_scope
    from gateway.session_local import publish_local_policy
    from gateway.session_platform_model import binding_key, clear_managed_selection, managed_state, _interrupt_active
    from gateway.session_runtime_workers import tracked_write
    from gateway.session_model_requests import register_group_model_viewer, selection_for_session
    async with async_owner_scope(grant.target):
        rpc = _rpc(grant)
        if model_id is None:
            if await rpc._dispatch('resolve_exact', {}) is None:
                register_group_model_viewer(grant, rpc.ref.session_id, connection.transport)
                return _following_result(grant, rpc.ref.session_id)
        else:
            await rpc._dispatch('create', {})
        sid, authority = rpc.ref.session_id, grant.target
        live = authority.sessions[sid]
        async with live.mutation_lock:
            _validate(grant)
            register_group_model_viewer(grant, sid, connection.transport)
            selected = await asyncio.to_thread(selection_for_session, authority, sid)
            if selected is not None:
                if selected['model_source'] == 'provider':
                    return await _apply_provider_selection(grant, rpc, selected)
                if grant.model_owner is None or selected.get('owner') != asdict(grant.model_owner):
                    raise RuntimeStoreError('managed_binding_forbidden')
                model_id = selected['model_id']
            previous = getattr(live, 'group_model_grant', None)
            changed_owner = previous is not None and previous.model_owner != grant.model_owner
            if previous is None and grant.model_owner is not None:
                from gateway.session_ancillary import physical_target
                saved = authority.db.get_session_model_config_value(physical_target(authority, rpc.ref), 'platform_owner')
                changed_owner = bool(saved and saved != asdict(grant.model_owner))

            def publish(changed):
                if changed:
                    clear_managed_selection(authority, sid)
                    publish_local_policy(authority, sid)
                return changed
            await tracked_write(authority, partial(_select, grant, sid, model_id, changed_owner=changed_owner), publish)
            _validate(grant)
            if model_id is None:
                live.__dict__.pop('group_model_grant', None)
                return _following_result(grant, sid)
            live.group_model_grant = grant
            state = managed_state(authority, sid)
            peer, key = connection.transport, binding_key(authority, sid)
            if state.get('transport') not in (None, peer):
                get_registry().clear_session(key, purpose='chat')
            state['transport'] = peer
            state['managed_model_params']['platform_owner'] = asdict(grant.model_owner)
            state['running'] = authority._handle(rpc.ref).execution_state == 'running'
            state['_interrupt_managed'] = lambda: _interrupt_active(authority, rpc.ref)
            ticket = get_registry().issue(key, state, peer, grant.model_owner, model_id)
        return {'profile': grant.profile, 'session_id': sid, 'model_id': model_id,
                'session_ticket': ticket, 'managed_model_binding': 1,
                'managed_model_context_window': True, 'managed_image_binding': 1, 'managed_device_key': 1}


async def _inspect_selection(connection, grant):
    from gateway.session_authorities import async_owner_scope
    from gateway.session_model_requests import register_group_model_viewer, selection_for_session
    async with async_owner_scope(grant.target):
        rpc = _rpc(grant)
        _validate(grant)
        if await rpc._dispatch('resolve_exact', {}) is None:
            register_group_model_viewer(grant, rpc.ref.session_id, connection.transport)
            return {'profile': grant.profile, 'session_id': rpc.ref.session_id, 'selection': None}
        register_group_model_viewer(grant, rpc.ref.session_id, connection.transport)
        selected = await asyncio.to_thread(selection_for_session, grant.target, rpc.ref.session_id)
        _validate(grant)
        return {'profile': grant.profile, 'session_id': rpc.ref.session_id, 'selection': selected}


async def _apply_provider_selection(grant, rpc, selected):
    """Only a validated room/member's saved route can reach the normal model writer."""
    import uuid
    from gateway.session_mutations import write_mutation
    from gateway.session_policy import policy_for_source
    from hermes_state_mutation_guards import MUTATION_GUARD_REFUSALS
    authority, sid = grant.target, rpc.ref.session_id
    live = authority.sessions[sid]
    policy = policy_for_source(authority.runner, live.source)
    model = (policy.config(authority).get('model') or {})
    if model.get('provider') != selected['provider'] or policy.current_model(authority) != selected['model_id']:
        handle = authority._handle(rpc.ref)
        try:
            result = await write_mutation(authority, rpc.ref, {
                'session_id': sid, 'request_id': 'group-model:' + uuid.uuid4().hex,
                'expected_revision': handle.revision, 'expected_generation': handle.execution_generation,
                'operation': 'model', 'payload': {'model': selected['model_id'], 'provider': selected['provider']},
            }, None, principal_id=rpc.principal.subject)
        except MUTATION_GUARD_REFUSALS as exc:
            raise RuntimeStoreError('session_busy') from exc
        if result.get('status') == 'confirmation_required':
            raise RuntimeStoreError('model_confirmation_required')
    _validate(grant)
    live.__dict__.pop('group_model_grant', None)
    return {'profile': grant.profile, 'session_id': sid, 'selection': selected}


async def prepare_group_model(connection, params):
    from gateway.hosted_rooms import HostedRoomError
    from gateway.session_runtime_workers import track_mutation
    from tui_gateway.methods_managed_model import _managed_owner, _managed_text
    try:
        if 'inspect_selection' in params or 'apply_selection' in params:
            flag = 'inspect_selection' if 'inspect_selection' in params else 'apply_selection'
            if params[flag] is not True or ({'owner', 'model_id', 'follow_profile_config', 'inspect_selection', 'apply_selection'} - {flag}) & set(params):
                raise RuntimeStoreError('invalid_params')
            grant = await asyncio.to_thread(_grant, connection, params, None)
            if flag == 'inspect_selection':
                return await _inspect_selection(connection, grant)
            inspected = await _inspect_selection(connection, grant)
            if not inspected['selection'] or inspected['selection']['model_source'] != 'provider':
                raise RuntimeStoreError('invalid_params')
            return await asyncio.shield(track_mutation(grant.target, _prepare(connection, grant, None)))
        if 'follow_profile_config' in params:
            if params['follow_profile_config'] is not True or {'owner', 'model_id'} & set(params):
                raise RuntimeStoreError('invalid_params')
            owner, model_id = None, None
        else:
            owner, model_id = _managed_owner(params), _managed_text(params, 'model_id', 128)
        grant = await asyncio.to_thread(_grant, connection, params, owner)
        return await asyncio.shield(track_mutation(grant.target, _prepare(connection, grant, model_id)))
    except HostedRoomError as exc:
        raise RuntimeStoreError(exc.reason) from None
    except (ManagedBindingError, ValueError, TypeError) as exc:
        raise RuntimeStoreError(str(exc)) from None
