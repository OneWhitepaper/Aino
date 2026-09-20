"""Managed participant commands cannot launch work outside the conversation coordinator."""
from tests.tui_gateway.test_conversation_session_binding import runtime_env, _conversation  # noqa: F401


def test_direct_slash_preserves_reads_but_cannot_start_review_or_compression(runtime_env, monkeypatch):
    from tui_gateway.session_conversation_binding import resolve_conversation_session
    import agent.review_engine

    server, store, install, _home, _root = runtime_env
    binding = _conversation(store, install)
    runtime = resolve_conversation_session(server, binding=binding, project=None, source='desktop')
    invoked = []

    def review(*args, **kwargs):
        invoked.append('review')
        raise RuntimeError('A review would have started outside its coordinator')

    monkeypatch.setattr(agent.review_engine, 'start_review', review)
    params = {'session_id': runtime.runtime_id}
    assert 'result' in server._methods['slash.exec']('read', {**params, 'command': '/model'})
    for command in ('/review', '/compress'):
        result = server._methods['slash.exec']('mutation', {**params, 'command': command})
        assert not invoked
        assert result['error']['code'] == 4120


def test_coordinator_reads_only_the_owned_generation_without_publication(runtime_env):
    import copy
    from tui_gateway.session_conversation_binding import resolve_conversation_session
    from tui_gateway.conversation_service import ConversationService
    from tui_gateway.transport import bind_transport, reset_transport

    server, store, install, _home, _root = runtime_env
    binding = _conversation(store, install)
    runtime = resolve_conversation_session(server, binding=binding, project=None, source='desktop')
    ConversationService(server, db_path=store.db_path)
    session = server._sessions[runtime.runtime_id]
    params = {'conversation_id': 'conversation', 'participant_id': 'writer',
              'expected_generation': runtime.session_generation,
              'expected_revision': store.get('conversation').revision, 'command': '/model'}
    before = copy.deepcopy((session['history'], session['agent'].tools, session['agent']._cached_system_prompt))
    events = store.events('conversation').events
    call = server._methods['conversations.command']
    result = call('model', params)['result']
    assert result['scope'] == 'private' and result['type'] == 'notice'
    assert result['runtime_id'] == runtime.runtime_id
    assert session['agent'].model in result['output']
    for command in ('/help', '/usage', '/status', '/history', '/prompt', '/context', '/tools'):
        assert call('read', {**params, 'command': command})['result']['output']
    for change in ({'expected_generation': runtime.session_generation + 1},
                   {'expected_revision': params['expected_revision'] + 1},
                   {'participant_id': 'general'}, {'profile': 'reviewer'}):
        assert 'error' in call('stale', {**params, **change})
    for command in ('/model other', '/personality writer', '/tools reload', '/profile reviewer'):
        result = call('mutation', {**params, 'command': command})
        assert result['error']['code'] == 4120
        assert result['error']['data']['reason'] == 'refresh_required'
    for command in ('/review', '/compress', '/plugin-command', '/skill-command'):
        assert 'error' in call('unsupported', {**params, 'command': command})

    class Stranger:
        auth_identity = {'provider': 'test', 'user_id': 'stranger'}
    token = bind_transport(Stranger())
    try:
        assert 'error' in call('foreign', params)
    finally:
        reset_transport(token)
    assert store.events('conversation').events == events
    assert (session['history'], session['agent'].tools, session['agent']._cached_system_prompt) == before
    del server._sessions[runtime.runtime_id]
    assert 'error' in call('offline', params)
    assert not server._sessions
    session['agent'].close()
