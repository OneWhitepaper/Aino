"""Request authorization and concrete live owner peers for conversation execution."""
from __future__ import annotations

from gateway.hosted_room_conversation_owners import (
    LOCAL_OWNER, ConversationOwnershipError, owner_key, require_owner,
)
from tui_gateway.transport import FanoutTransport, current_transport


def request_owner_key(server, *, write=False, transport=None) -> str:
    peer = current_transport() if transport is None else transport
    if isinstance(peer, FanoutTransport):
        raise ConversationOwnershipError('conversation authority requires a concrete owner transport')
    identity = getattr(peer, 'auth_identity', None)
    principal = server._transport_auth_user_id(peer)
    if identity is not None and principal is None:
        raise ConversationOwnershipError('conversation owner identity is invalid')
    if write and identity is not None:
        from tui_gateway.managed_model_runtime import transport_principal, ManagedBindingError
        try:
            transport_principal(peer)
        except ManagedBindingError as exc:
            raise ConversationOwnershipError('conversation owner has no write authority') from exc
    return owner_key(principal)


def require_conversation_owner(server, db_path, conversation_id, *, write=False, claim_unowned=False):
    key = request_owner_key(server, write=write)
    require_owner(db_path, conversation_id, key, claim_unowned=claim_unowned)
    return key


def live_owner_transport(server, session, metadata):
    """Choose an attached eligible peer, never the event fanout as an authentication identity."""
    expected = owner_key(metadata.get('auth_user_id'))
    peers = server._session_live_transports(session)
    if expected == LOCAL_OWNER and session.get('transport') is server._stdio_transport:
        peers.append(server._stdio_transport)
    for peer in peers:
        try:
            key = request_owner_key(server, write=True, transport=peer)
        except ConversationOwnershipError:
            continue
        if key == expected and server._session_transport_contains(session, peer):
            require_owner(server._conversation_db_path, metadata['conversation_id'], expected)
            return peer
    raise ConversationOwnershipError('participant owner transport is unavailable')
