"""Profile-bound live-work discovery, including exact native room-member provenance."""
import asyncio
from pathlib import Path

from hermes_state_runtime import RuntimeStoreError


async def roster(connection, ref, params):
    from gateway.runtime_bootstrap import _PURPOSE_CAPABILITIES
    from gateway.session_authorities import require_serving
    from hermes_cli.profiles import profile_matches_home

    if set(params) - {'profile'}:
        raise RuntimeStoreError('invalid_params')
    # This used to reach the interactive-only legacy fallback; keep exactly that grant.
    if not _PURPOSE_CAPABILITIES['interactive'] <= connection.actor.capabilities:
        raise RuntimeStoreError('permission_denied')
    require_serving(connection.authority)
    if ref.profile_id != connection.authority.profile_id:
        raise RuntimeStoreError('profile_mismatch')
    profile = params.get('profile')
    if profile is not None and not isinstance(profile, str):
        raise RuntimeStoreError('invalid_params')
    if profile and not profile_matches_home(profile, Path(connection.authority.profile_id)):
        raise RuntimeStoreError('profile_mismatch')
    return await asyncio.to_thread(_projection, connection)


def _projection(connection):
    from gateway.session import _session_key_namespace
    from gateway.session_authorities import served_profile_name
    from tui_gateway.methods_subagents import live_work_roster

    authority = connection.authority
    registry = getattr(getattr(authority, 'runner', None), 'session_authorities', None)
    profile = served_profile_name(authority.profile_id)
    route_profile = registry.profile_name(authority) if registry is not None else None
    namespaces = {_session_key_namespace(name).split(':', 1)[1] for name in (profile, route_profile)}
    return live_work_roster(authority.db, namespaces, room_sources=_room_sources(connection))


def _room_sources(connection):
    """Existing services' exact live member refs only; no cold restore or cross-owner probe."""
    from gateway.hosted_rooms import HostedRoomError
    from gateway.owner_identity import same_owner
    from gateway.session_authorities import all_authorities, owner_scope, served_profile_name

    target = connection.authority
    authorities = all_authorities(getattr(target, 'runner', None)) if connection.host_scoped else [target]
    if target not in authorities:
        authorities.append(target)
    result = {}
    for authority in authorities:
        service = getattr(authority, 'hosted_room_service', None)
        if service is None or getattr(service, 'authority', None) is not authority:
            continue
        with owner_scope(authority):
            for key, rpc in list(service.member_rpcs.items()):
                room_id, member, profile, owner, home = key
                ref = getattr(rpc, 'ref', None)
                if (ref is None or ref.profile_id != target.profile_id or Path(home) != Path(target.profile_id)
                        or not same_owner(owner, connection.actor.subject)):
                    continue
                try:
                    if not same_owner(service._owner(room_id), owner):
                        continue
                    service._owned_authority(room_id)
                    room = service._room(room_id)
                except (HostedRoomError, RuntimeStoreError):
                    # A removed room/member never becomes an ordinary conversation on a late poll.
                    continue
                if not any(m['member_id'] == member and m['profile'] == profile
                           and (m.get('target') or {}).get('kind', 'local') == 'local' for m in room['members']):
                    continue
                source = {'kind': 'bot_room', 'room_id': room_id, 'room_name': room['name'],
                          'profile': served_profile_name(authority.profile_id)}
                aliases = {ref.session_id, target.db.get_compression_tip(ref.session_id)}
                for sid in aliases - {None}:
                    if (target.db.get_session(sid) or {}).get('source') == 'bot_room':
                        result[sid] = source
    return result
