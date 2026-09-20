"""Conversation owners survive empty drafts, reconnects and exact participant controls."""
from __future__ import annotations

from contextlib import contextmanager

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tui_gateway.transport import bind_transport, reset_transport
from gateway.hosted_room_conversation_owners import ConversationOwnershipError


class Peer:
    def __init__(self, user, **identity):
        self.auth_identity = {'provider': 'test', 'user_id': user, **identity}
        self._closed = False

    def write(self, _frame):
        return not self._closed


@contextmanager
def caller(peer):
    token = bind_transport(peer)
    try:
        yield
    finally:
        reset_transport(token)


@pytest.mark.parametrize('with_session', [False, True])
def test_foreign_controls_and_replays_cannot_read_or_replace_owner(runtime_env, monkeypatch, with_session):
    from gateway import hosted_room_driver as driver
    from tui_gateway.hosted_room_service import HostedRoomService
    from tui_gateway.session_conversation_binding import refresh_conversation_preparation
    server, store, install, home, root = runtime_env
    hosted = HostedRoomService(server, db_path=store.db_path)
    service = hosted.conversations
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    def rpc(name, **params):
        return server._methods['conversations.' + name]('authority', params)
    owner, foreign = Peer('owner'), Peer('foreign')
    with caller(owner):
        catalog = rpc('participants')['result']['participants']
        general = next(r['participant']['participant_id'] for r in catalog if r['participant']['is_general'])
        writer = next(r['participant']['participant_id'] for r in catalog if r['participant']['profile'] == 'writer')
        creation = {'conversation_id': 'c', 'title': 'Work', 'general_participant_id': general}
        assert 'result' in rpc('create', **creation)
        if with_session:
            assert 'result' in rpc('prepare', conversation_id='c', participant_id=writer)
            request = {'conversation_id': 'c', 'turn_id': 'turn', 'input_id': 'input',
                       'participant_id': writer, 'text': 'Hello', 'expected_revision': store.get('c').revision}
            assert 'result' in rpc('send', **request)
        before = service.get('c')
    with caller(foreign):
        from tui_gateway.conversation_service import ConversationService
        reopened = ConversationService(server, db_path=store.db_path)
        assert reopened.list()['conversations'] == []
        with pytest.raises(ConversationOwnershipError):
            reopened.get('c')
        assert rpc('list')['result']['conversations'] == []
        for name, params in (
            ('create', creation), ('get', {'conversation_id': 'c'}), ('events', {'conversation_id': 'c'}),
            ('prepare', {'conversation_id': 'c', 'participant_id': writer}),
            ('stop', {'conversation_id': 'c', 'turn_id': 'turn', 'execution_generation': 0}),
            ('retry', {'conversation_id': 'c', 'turn_id': 'turn', 'input_id': 'input', 'expected_generation': 0}),
            ('refresh', {'conversation_id': 'c', 'participant_id': writer, 'expected_generation': 1}),
            ('send', request if with_session else {'conversation_id': 'c', 'turn_id': 'turn', 'input_id': 'input',
                'participant_id': writer, 'text': 'Hello', 'expected_revision': before['conversation']['revision']}),
        ):
            assert 'error' in rpc(name, **params), name
    with caller(Peer('owner', read_only=True)):
        assert 'result' in rpc('events', conversation_id='c')
        assert 'error' in rpc('stop', conversation_id='c', turn_id='turn', execution_generation=0)
    with caller(None):
        assert 'error' in rpc('get', conversation_id='c')
        if with_session:
            from tui_gateway.session_conversation_binding import ConversationBindingError
            live = next(s for s in server._sessions.values() if s.get('_conversation_binding', {}).get('conversation_id') == 'c')
            with pytest.raises(ConversationBindingError, match='another authenticated user'):
                server._methods['session.resume']('anonymous', {'session_id': live['session_key'], 'profile': 'writer'})
    with caller(owner):
        assert service.get('c') == before
        assert [r['conversation_id'] for r in service.list()['conversations']] == ['c']
        if with_session:
            assert rpc('send', **request)['result']['admission']['idempotent'] is True
            task = driver.list_tasks(store.db_path, room_id='c')[0]
            assert task['status'] == 'queued'
            assert service.stop('c', 'turn', 0)['status'] == 'confirmed'
    if with_session:
        # Even the direct helper must deny a stranger before it can retire the old generation.
        binding = next(b for b in store.participants('c') if b.participant.participant_id == writer)
        revision = store.get('c').revision
        for cold in (False, True):
            if cold:
                for sid, session in tuple(server._sessions.items()):
                    if session.get('_conversation_binding', {}).get('conversation_id') == 'c':
                        if session.get('agent'):
                            session['agent'].close()
                        del server._sessions[sid]
            with caller(foreign), pytest.raises(ConversationOwnershipError, match='owner'):
                refresh_conversation_preparation(server, binding=binding, project=None, source='desktop')
            assert store.get('c').revision == revision
            assert next(b for b in store.participants('c') if b.participant.participant_id == writer) == binding


def test_owner_fanout_uses_live_eligible_peer_and_preserves_local_boundary(runtime_env, monkeypatch):
    from gateway import hosted_room_driver as driver
    from tui_gateway.hosted_room_service import HostedRoomService
    from tui_gateway.conversation_transport import ConversationTransport
    server, store, install, home, root = runtime_env
    hosted = HostedRoomService(server, db_path=store.db_path)
    service = hosted.conversations
    first, second, foreign = Peer('owner'), Peer('owner'), Peer('foreign')
    with caller(first):
        catalog = service.catalog()
        general = next(r['participant']['participant_id'] for r in catalog if r['participant']['is_general'])
        service.create('c', 'Work', general)
        prepared = service.prepare('c', general)
        service.send('c', 't', 'i', general, 'Hello', store.get('c').revision)
    session = server._sessions[prepared['session_id']]
    with caller(second):
        assert service.prepare('c', general)['session_id'] == prepared['session_id']
    task = driver.list_tasks(store.db_path, room_id='c')[0]
    transport = ConversationTransport(service, task)
    transport.check_available()
    server._detach_session_transport(session, first)
    with transport._owner():
        from tui_gateway.transport import current_transport
        assert current_transport() is second
    second._closed = True
    with pytest.raises(ConversationOwnershipError, match='owner transport'):
        transport.check_available()
    third = Peer('owner')
    with caller(third):
        service.prepare('c', general)
    transport.check_available()
    server._detach_session_transport(session, third)
    session['transport'].attach(foreign)
    session['transport'].attach(Peer('owner', read_only=True))
    class UnidentifiedPeer:
        def write(self, _frame):
            return True
    session['transport'].attach(UnidentifiedPeer())
    with pytest.raises(ConversationOwnershipError, match='owner transport'):
        transport.check_available()
    # Legacy local/token callers keep their existing backend boundary, but never gain an authenticated chat.
    with caller(None):
        service.create('local', 'Local', general)
        assert service.get('local')['conversation']['conversation_id'] == 'local'
        with pytest.raises(ConversationOwnershipError):
            service.get('c')
    with caller(first), pytest.raises(ConversationOwnershipError):
        service.get('local')
