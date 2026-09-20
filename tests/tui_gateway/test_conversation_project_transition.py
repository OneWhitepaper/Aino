"""Changing a shared project's directory retires participant generations, never old prompts."""
from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_notifications import provider, _setup, _settle  # noqa: F401
from tests.tui_gateway.test_conversation_attachments import service_rpc
from tests.tui_gateway.test_conversation_authority import Peer, caller


def register_project(home, root, install, name):
    from hermes_cli import projects_db
    directory = root / name
    directory.mkdir()
    (directory / 'AGENTS.md').write_text(f'Project rule: {name}-project-marker.')
    with projects_db.connect_closing(home / 'projects.db') as conn:
        identifier = projects_db.create_project(conn, name=name, primary_path=str(directory))
    return dict(install_id=install, registration_profile='default', project_id=identifier,
                cwd=str(directory), execution_environment_id='local')


def test_project_change_keeps_public_history_and_rebuilds_all_participants_at_new_cwd(runtime_env, monkeypatch, provider):
    server, store, install, home, root = runtime_env
    hosted, rpc = service_rpc(server, store, monkeypatch)
    service = hosted.conversations
    ids = {row['participant']['profile']: row['participant']['participant_id'] for row in service.catalog()}
    first = register_project(home, root, install, 'novel')
    second = register_project(home, root, install, 'media')
    service.create('project-change', 'Work', ids['default'], first)
    service.prepare('project-change', ids['writer'], model_source='byok', model_id='gpt-4.1')
    service.prepare('project-change', ids['reviewer'])

    def run_turn(number):
        service.send('project-change', f't{number}', f'i{number}', ids['writer'], f'User request {number}',
                     store.get('project-change').revision)
        room = service.bindings()[0]
        hosted.runtime.turn_timeout_seconds = 15
        hosted.runtime._process_room(room)
        service.prepare_room(room)
        task = next(task for task in service._tasks('project-change') if task['identity'].turn_id == f't{number}')
        assert task['status'] == 'settled'

    run_turn(1)
    before = service.get('project-change')
    history = service.events('project-change')
    old_sessions = {sid: session for sid, session in server._sessions.items()
                    if session.get('_conversation_binding', {}).get('conversation_id') == 'project-change'}
    old_writer = next(session for session in old_sessions.values()
                      if session['_conversation_binding']['participant_id'] == ids['writer'])
    old_prompt = old_writer['agent']._cached_system_prompt
    assert 'novel-project-marker' in old_prompt
    changed = rpc('set_project', conversation_id='project-change', project_ref=second,
                  expected_revision=before['conversation']['revision'])['result']
    assert changed['conversation']['project'] == second
    assert changed['conversation']['general'] == before['conversation']['general']
    generations = {b['participant']['participant_id']: b['session_generation'] for b in before['participants']}
    assert all(b['session_generation'] == generations[b['participant']['participant_id']] + 1
               and b['lineage_id'] is None for b in changed['participants'])
    assert service.events('project-change') == history
    assert old_writer['agent']._cached_system_prompt == old_prompt and old_writer['cwd'] == first['cwd']
    assert rpc('set_project', conversation_id='project-change', project_ref=second,
               expected_revision=changed['conversation']['revision'])['result'] == changed
    prepared = service.prepare('project-change', ids['writer'], expected_generation=2)
    assert prepared['model_config']['model'] == 'gpt-4.1'
    assert server._sessions[prepared['session_id']]['cwd'] == second['cwd']
    run_turn(2)
    current = server._sessions[prepared['session_id']]['agent']
    assert 'media-project-marker' in current._cached_system_prompt
    assert current._cached_system_prompt != old_prompt
    assert old_writer['agent']._cached_system_prompt == old_prompt
    assert len(service.events('project-change')['events']) > len(history['events'])
    assert 'User request 1' in store.prepared_input('project-change', 'i2').text


def test_project_change_refuses_foreign_stale_busy_and_background_work_without_partial_mutation(runtime_env, monkeypatch):
    server, store, install, home, root = runtime_env
    server, service, notifications, _sid, session, _lease, attempt, _general = _setup(runtime_env, monkeypatch)
    project = register_project(home, root, install, 'project')
    def change(revision=None, **overrides):
        params = dict(conversation_id='c', project_ref=project,
                      expected_revision=store.get('c').revision if revision is None else revision)
        return server._methods['conversations.set_project']('project-change', {**params, **overrides})
    before = service.get('c')
    assert 'error' in change()
    assert service.get('c') == before
    notifications.capture(session['_conversation_binding'], attempt, 'pending-child')
    _settle(service, attempt)
    before = service.get('c')
    assert 'error' in change()
    assert service.get('c') == before
    notifications.rejected('pending-child')
    before = service.get('c')
    with caller(Peer('foreign')):
        assert 'error' in change()
    assert 'error' in change(revision=before['conversation']['revision'] - 1)
    assert 'error' in change(project_ref={**project, 'project_id': 'missing'})
    assert 'error' in change(project_ref={**project, 'cwd': str(root / 'another-directory')})
    assert service.get('c') == before
    result = change()['result']
    assert result['conversation']['project'] == project
    assert all(b['session_generation'] == 2 for b in result['participants'])


def test_project_change_retires_pending_command_without_losing_consumed_replay(runtime_env, monkeypatch, provider):
    from tests.tui_gateway.test_conversation_command_tokens import _skills
    server, store, install, home, root = runtime_env
    _skills(home)
    hosted, rpc = service_rpc(server, store, monkeypatch)
    service = hosted.conversations
    ids = {row['participant']['profile']: row['participant']['participant_id'] for row in service.catalog()}
    service.create('commands', 'Commands', ids['default'])
    service.prepare('commands', ids['writer'])
    def command():
        return rpc('command', conversation_id='commands', participant_id=ids['writer'],
                   expected_generation=1, expected_revision=store.get('commands').revision,
                   command='/shared-command do work')['result']
    consumed = command()
    args = dict(conversation_id='commands', participant_id=ids['writer'], turn_id='turn', input_id='input',
                text=consumed['display'], expected_revision=consumed['conversation_revision'],
                command_token=consumed['command_token'])
    admitted = rpc('send', **args)['result']['admission']
    room = service.bindings()[0]
    hosted.runtime.turn_timeout_seconds = 15
    hosted.runtime._process_room(room)
    service.prepare_room(room)
    assert service._tasks('commands')[0]['status'] == 'settled'
    pending = command()
    project = register_project(home, root, install, 'command-project')
    changed = rpc('set_project', conversation_id='commands', project_ref=project,
                  expected_revision=store.get('commands').revision)['result']
    history = service.events('commands')
    # Use the new revision so rejection demonstrates token retirement, not stale CAS.
    assert 'error' in rpc('send', **{**args, 'turn_id': 'retired', 'input_id': 'retired',
        'command_token': pending['command_token'], 'expected_revision': changed['conversation']['revision']})
    assert service.events('commands') == history
    assert rpc('send', **args)['result']['admission']['event_id'] == admitted['event_id']
    assert service.events('commands') == history


def test_project_change_preserves_aino_selection_but_requires_new_session_ticket(runtime_env, monkeypatch):
    from datetime import datetime, timedelta, timezone
    import pytest
    from tui_gateway.managed_model_runtime import get_registry
    from tui_gateway.session_conversation_binding import ConversationBindingError, resolve_conversation_session
    server, store, install, home, root = runtime_env
    hosted, rpc = service_rpc(server, store, monkeypatch)
    service = hosted.conversations
    ids = {row['participant']['profile']: row['participant']['participant_id'] for row in service.catalog()}
    owner, controller = Peer('creator'), Peer('creator')
    def call(peer, method, **params):
        with caller(peer):
            return server._methods[method]('project-managed', {'profile': 'writer', **params})
    def ticket(sid):
        return call(owner, 'session.managed_model_ticket', session_id=sid, model_id='catalog-model',
            owner={'platform_origin': 'http://127.0.0.1:9', 'user_id': 'platform-user'})['result']['session_ticket']
    def bind(sid, session_ticket, key):
        params = dict(session_id=sid, model_id='catalog-model',
                      owner={'platform_origin': 'http://127.0.0.1:9', 'user_id': 'platform-user'})
        claimed = call(controller, 'session.claim_managed_model', **params, session_ticket=session_ticket)
        if 'error' in claimed:
            return claimed
        return call(controller, 'session.bind_managed_model', **params,
            binding_revision=claimed['result']['binding_revision'], model='gpt-4.1-mini',
            api_mode='chat_completions', credential_id='fixture', api_key=key,
            base_url='http://127.0.0.1:9/v1', capabilities={'tools': True, 'vision': False, 'reasoning': True},
            expires_at=(datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat())
    with caller(owner):
        service.create('managed-project', 'Managed', ids['default'])
        first = service.prepare('managed-project', ids['writer'], model_source='aino', model_id='catalog-model')
        old_sid = first['session_id']
        old_ticket = ticket(old_sid)
        assert bind(old_sid, old_ticket, 'old-generation-key')['result']['bound']
        assert get_registry().get(old_sid, server._sessions[old_sid]) is not None
        project = register_project(home, root, install, 'managed-project')
        assert 'result' in rpc('set_project', conversation_id='managed-project', project_ref=project,
                              expected_revision=store.get('managed-project').revision)
        prepared = service.prepare('managed-project', ids['writer'], expected_generation=2)
        sid = prepared['session_id']
        assert sid != old_sid and prepared['stored_session_id'] != first['stored_session_id']
        assert prepared['model_config']['model_source'] == 'aino'
        assert prepared['model_config']['model_id'] == first['model_config']['model_id']
        assert prepared['model_status'] == 'awaiting_managed_credentials'
        assert get_registry().get(sid, server._sessions[sid]) is None
        assert server._sessions[sid]['agent'] is None
        binding = next(b for b in store.participants('managed-project') if b.participant.participant_id == ids['writer'])
        with pytest.raises(ConversationBindingError, match='awaiting_managed_credentials'):
            resolve_conversation_session(server, binding=binding, project=store.get('managed-project').project,
                                         source='desktop')
        assert 'error' in bind(sid, old_ticket, 'must-not-bind')
        assert get_registry().get(sid, server._sessions[sid]) is None
        assert bind(sid, ticket(sid), 'new-generation-key')['result']['bound']
        assert service.prepare('managed-project', ids['writer'], expected_generation=2)['model_status'] == 'ready'
        runtime = resolve_conversation_session(server, binding=binding, project=store.get('managed-project').project,
                                               source='desktop')
        assert runtime.runtime_id == sid and server._sessions[sid]['cwd'] == project['cwd']
        assert runtime.model_snapshot['model_source'] == 'aino'
        assert get_registry().get(old_sid, server._sessions[old_sid]).api_key == 'old-generation-key'
        assert get_registry().get(sid, server._sessions[sid]).api_key == 'new-generation-key'
