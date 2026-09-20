"""Conversation generations keep exact Profile ownership and require a live driver lease."""
from __future__ import annotations

import copy
import time
from dataclasses import replace
from pathlib import Path

import pytest
import yaml

from gateway import hosted_room_driver as driver, hosted_rooms
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef, ProjectRef
from tui_gateway.session_conversation_binding import (
    ConversationBindingError, issue_conversation_submission, prepare_conversation_agent,
    require_conversation_submission, resolve_conversation_session, refresh_conversation_session,
    verify_conversation_prompt_snapshot, prepare_conversation_session, refresh_conversation_preparation,
)


@pytest.fixture
def runtime_env(tmp_path, monkeypatch):
    import hermes_state
    real_state_root = hermes_state._real_platform_state_root()
    monkeypatch.setattr(hermes_state, '_real_platform_state_root', lambda: real_state_root)
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    home = tmp_path / '.hermes'
    home.mkdir()
    monkeypatch.setenv('HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('OPENAI_API_KEY', 'test-only-no-network')
    monkeypatch.delenv('HERMES_DESKTOP', raising=False)
    monkeypatch.delenv('HERMES_TUI_TOOLSETS', raising=False)
    from tui_gateway import server
    from hermes_state import SessionDB
    db = SessionDB(home / 'state.db')
    monkeypatch.setattr(server, '_hermes_home', home)
    monkeypatch.setattr(server, '_db', db)
    monkeypatch.setattr(server, '_sessions', {})
    monkeypatch.setattr(server, '_conversation_db_path', home / 'shared-state.db', raising=False)
    # UI pumps have no consumer in this test; all session/profile/model/DB resolution stays real.
    for name in ('_emit', '_schedule_session_cap_enforcement',
                 '_start_session_services', '_wire_callbacks', '_schedule_mcp_late_refresh'):
        monkeypatch.setattr(server, name, lambda *a, **kw: None)
    monkeypatch.setattr(server, '_enable_gateway_prompts', lambda: None)
    cfg = {'model': {'default': 'gpt-4.1-mini', 'provider': 'custom:test'},
           'providers': {'test': {'api': 'http://127.0.0.1:9/v1', 'api_key': 'test-only-no-network'}},
           'terminal': {'backend': 'local'}, 'toolsets': ['terminal'],
           'agent': {'system_prompt': 'generation instruction'},
           'dashboard': {'turn_isolation': False},
           'conversations': {'enabled': True},
           'display': {'show_reasoning': False}}
    for name in ('default', 'writer', 'reviewer'):
        target = home if name == 'default' else home / 'profiles' / name
        target.mkdir(parents=True, exist_ok=True)
        private = tmp_path / ('private-' + name)
        private.mkdir()
        profile_cfg = {**cfg, 'terminal': {'backend': 'local', 'cwd': str(private)}}
        (target / 'config.yaml').write_text(yaml.safe_dump(profile_cfg))
        (target / '.env').write_text('OPENAI_API_KEY=test-only-no-network\n')
    install = hosted_rooms.local_authority_gateway_id()
    store = ConversationStore(home / 'shared-state.db')
    from tui_gateway.transport import bind_transport, reset_transport
    class FixtureOwner:
        auth_identity = {'provider': 'test', 'user_id': 'creator'}
        def write(self, frame):
            return server._stdio_transport.write(frame)
    token = bind_transport(FixtureOwner())
    try:
        yield server, store, install, home, tmp_path
    finally:
        reset_transport(token)
    for record in list(server._sessions.values()):
        agent = record.get('agent')
        if agent is not None:
            agent.close()
    db.close()


def _conversation(store, install, project=None, name='conversation'):
    general = ParticipantRef('general', install, 'default', 'General', True)
    store.create(name, 'Conversation', general, project)
    return store.bind_participant(name, ParticipantRef('writer', install, 'writer', 'Writer'))


def test_profile_sessions_share_only_explicit_project_and_restore_generation(runtime_env):
    server, store, install, home, root = runtime_env
    project_dir = root / 'project'
    project_dir.mkdir()
    project = ProjectRef(install, 'default', 'project', str(project_dir), 'local')
    binding = _conversation(store, install, project)
    reviewer = store.bind_participant('conversation', ParticipantRef('reviewer', install, 'reviewer', 'Reviewer'))
    from tui_gateway.transport import bind_transport, reset_transport
    class OwnerTransport:
        auth_identity = {'provider': 'test', 'user_id': 'creator'}
        def write(self, _frame):
            return True
        def close(self):
            pass
    token = bind_transport(OwnerTransport())
    try:
        a = resolve_conversation_session(server, binding=binding, project=project, source='desktop')
    finally:
        reset_transport(token)
    b = resolve_conversation_session(server, binding=reviewer, project=project, source='desktop')
    ar, br = server._sessions[a.runtime_id], server._sessions[b.runtime_id]
    assert (a.profile, b.profile) == ('writer', 'reviewer')
    assert a.runtime_id != b.runtime_id and ar['profile_home'] != br['profile_home']
    assert ar['cwd'] == br['cwd'] == str(project_dir)
    assert ar['source'] == br['source'] == 'desktop'
    assert {'desktop_ui', 'project'} <= set(server._load_enabled_toolsets('desktop'))
    for record, runtime in ((ar, a), (br, b)):
        with server._session_db(record) as db:
            row = db.get_session(runtime.lineage_id)
            assert row['profile_name'] == runtime.profile and row['source'] == 'desktop'
            assert row['cwd'] == str(project_dir)
    with pytest.raises(ConversationBindingError, match='driver-owned'):
        require_conversation_submission(ar, {'conversation_id': 'conversation'})
    assert server._methods['prompt.submit']('direct', {'session_id': a.runtime_id, 'text': 'bypass'})['error']['code'] == 4120
    from tui_gateway.turn_marker import record_turn_start
    record_turn_start(ar['profile_home'], a.lineage_id, 'must be recovered by the driver')
    assert server._maybe_schedule_auto_continue(a.runtime_id, ar, a.lineage_id) is None
    for mutation in (
        lambda: server._apply_model_switch(a.runtime_id, ar, 'other'),
        lambda: server._reset_session_agent(a.runtime_id, ar),
        lambda: server._rewind_active_session_history(ar, 0),
        lambda: server._set_session_cwd(ar, str(root)),
    ):
        with pytest.raises((ConversationBindingError, ValueError)):
            mutation()
    assert server._methods['slash.exec']('slash', {'session_id': a.runtime_id, 'command': '/new'})['error']['code'] == 4120
    assert server._methods['command.dispatch']('command', {'session_id': a.runtime_id, 'name': 'undo'})['error']['code'] == 4120
    assert 'result' in server._methods['slash.exec']('read', {'session_id': a.runtime_id, 'command': '/model'})
    # Only an actual persisted prompt may make this generation recoverable.
    agent = ar['agent']
    agent._cached_system_prompt = 'exact first system prompt'
    with pytest.raises(ConversationBindingError, match='durably persisted'):
        verify_conversation_prompt_snapshot(agent)
    with server._session_db(ar) as db:
        db.update_system_prompt(a.lineage_id, agent._cached_system_prompt)
    verify_conversation_prompt_snapshot(agent)
    cfg_path = home / 'profiles' / 'writer' / 'config.yaml'
    cfg = yaml.safe_load(cfg_path.read_text())
    cfg['model']['default'] = 'gpt-4.1'
    cfg_path.write_text(yaml.safe_dump(cfg))
    server._sync_agent_model_with_config(a.runtime_id, ar)
    assert agent.model == a.model_snapshot['model']
    again = resolve_conversation_session(server, binding=binding, project=project, source='desktop')
    assert again.runtime_id == a.runtime_id and again.model_snapshot == a.model_snapshot
    # Cold resume rebuilds the real agent and restores metadata before auto-continue.
    agent.close()
    del server._sessions[a.runtime_id]
    cold = resolve_conversation_session(server, binding=binding, project=project, source='desktop')
    cr = server._sessions[cold.runtime_id]
    assert cold.lineage_id == a.lineage_id and cold.runtime_id != a.runtime_id
    assert cr['agent']._cached_system_prompt == 'exact first system prompt'
    assert cr['auth_user_id'] == 'test:creator'
    assert cr['agent']._user_id == 'test:creator'
    assert cold.model_snapshot == a.model_snapshot
    original = cr['agent'].ephemeral_system_prompt
    cr['agent'].ephemeral_system_prompt = 'different instruction'
    with pytest.raises(ConversationBindingError, match='snapshot changed'):
        prepare_conversation_agent(server, cr, cr['agent'])
    cr['agent'].ephemeral_system_prompt = original
    original_tools = copy.deepcopy(cr['agent'].tools)
    cr['agent'].tools.append({'type': 'function', 'function': {'name': 'unexpected_grant'}})
    with pytest.raises(ConversationBindingError, match='snapshot changed'):
        prepare_conversation_agent(server, cr, cr['agent'])
    cr['agent'].tools = original_tools
    for mode in ({'lazy': True}, {'defer_history': True}, {'eager_build': True}):
        cr['agent'].close()
        del server._sessions[cold.runtime_id]
        response = server._methods['session.resume']('resume-mode', {
            'session_id': a.lineage_id, 'profile': 'writer', 'omit_messages': True, **mode})
        assert 'error' not in response, response
        resumed_record = server._sessions[response['result']['session_id']]
        assert resumed_record['_conversation_binding']['lineage_id'] == a.lineage_id
        assert resumed_record['source'] == 'desktop'
        assert server._maybe_schedule_auto_continue(response['result']['session_id'], resumed_record, a.lineage_id) is None
        cold = resolve_conversation_session(server, binding=binding, project=project, source='desktop')
        cr = server._sessions[cold.runtime_id]
        assert cr['agent']._cached_system_prompt == 'exact first system prompt'
        assert cr['agent']._user_id == 'test:creator'
    revision_before_refresh = store.get('conversation').revision
    refreshed = refresh_conversation_session(server, binding=binding, project=project, source='desktop')
    assert store.get('conversation').revision == revision_before_refresh + 1
    assert refreshed.session_generation == a.session_generation + 1
    assert refreshed.lineage_id != a.lineage_id
    assert refreshed.model_snapshot['model'] == cfg['model']['default']
    binding = store.bind_participant('conversation', binding.participant)
    neutral_binding = _conversation(store, install, name='neutral')
    neutral = resolve_conversation_session(server, binding=neutral_binding, project=None, source='desktop')
    nr = server._sessions[neutral.runtime_id]
    assert store.get('neutral').project is None
    assert Path(nr['cwd']).parent == home / 'conversation-workspaces'
    assert nr['cwd'] != str(root / 'private-writer')
    with pytest.raises(ConversationBindingError, match='project changed'):
        resolve_conversation_session(server, binding=binding, project=replace(project, cwd='/nonexistent'), source='desktop')
    # The project can disappear after creation; do not heal to its parent.
    project_dir.rmdir()
    with pytest.raises(ConversationBindingError, match='inaccessible'):
        resolve_conversation_session(server, binding=binding, project=project, source='desktop')


def test_submission_proof_is_exact_live_task_and_environment_is_fail_closed(runtime_env):
    server, store, install, home, root = runtime_env
    binding = _conversation(store, install)
    runtime = resolve_conversation_session(server, binding=binding, project=None, source='desktop')
    record = server._sessions[runtime.runtime_id]
    identity = driver.TaskIdentity('conversation', 'task', 'thread', 'turn')
    driver.admit_task(store.db_path, identity, payload={'target_profile': 'writer',
        'target_member_id': 'writer', 'prompt': 'Work', 'source_event_seq': 1}, clock=time.time)
    lease = driver.acquire_lease(store.db_path, room_id='conversation', gateway_id=install,
        authority_epoch=1, process_generation='process', ttl_seconds=60, clock=time.time)
    attempt = driver.start_task(store.db_path, identity, lease, expected_cancel_generation=0, clock=time.time)
    with issue_conversation_submission(server, runtime, attempt=attempt) as proof:
        require_conversation_submission(record, proof)
        with pytest.raises(ConversationBindingError, match='ordinary session'):
            require_conversation_submission({}, proof)
        task = {'room_id': 'conversation', 'task_id': 'task', 'thread_id': 'thread', 'turn_id': 'turn',
                'execution_generation': attempt.execution_generation, 'member_id': 'writer'}
        assert server._hosted_submit_error('good', record, task, lambda _: None, proof) is None
        assert server._hosted_submit_error('bad', record, {**task, 'task_id': 'other'}, lambda _: None, proof)['error']
    with pytest.raises(ConversationBindingError, match='driver-owned'):
        require_conversation_submission(record, proof)
    with pytest.raises(ConversationBindingError, match='stale'):
        with issue_conversation_submission(server, runtime, attempt=replace(attempt, execution_generation=2)):
            pass
    cfg_path = home / 'profiles' / 'writer' / 'config.yaml'
    cfg = yaml.safe_load(cfg_path.read_text())
    cfg['dashboard']['turn_isolation'] = True
    cfg_path.write_text(yaml.safe_dump(cfg))
    with pytest.raises(ConversationBindingError, match='isolated compute'):
        resolve_conversation_session(server, binding=binding, project=None, source='desktop')
    cfg['dashboard']['turn_isolation'] = False
    cfg['terminal']['backend'] = 'ssh'
    cfg_path.write_text(yaml.safe_dump(cfg))
    with pytest.raises(ConversationBindingError, match='local terminal'):
        resolve_conversation_session(server, binding=binding, project=None, source='desktop')


def test_public_config_and_mcp_reload_preserve_bound_runtime(runtime_env, monkeypatch):
    from types import SimpleNamespace
    server, store, install, home, root = runtime_env
    binding = _conversation(store, install)
    runtime = resolve_conversation_session(server, binding=binding, project=None, source='desktop')
    record = server._sessions[runtime.runtime_id]
    agent = record['agent']

    def state():
        with server._session_db(record) as db:
            stored = db.get_session(runtime.lineage_id)
        return copy.deepcopy((agent.reasoning_config, agent.service_tier, agent.ephemeral_system_prompt,
                              record['history'], record.get('managed_model_params'),
                              record.get('pending_model_switch'), stored['model_config']))

    before = state()
    for running in (False, True):
        record['running'] = running
        for params in ({'key': 'reasoning', 'value': 'high'}, {'key': 'fast', 'value': 'normal'},
                       {'key': 'model', 'value': 'other'}, {'key': 'personality', 'value': 'none'},
                       {'key': 'model', 'value': 'catalog-other', 'model_source': 'aino',
                        'confirm_expensive_model': True}):
            result = server._methods['config.set']('set', {
                'session_id': runtime.runtime_id, 'profile': 'writer', **params})
            assert result['error']['code'] == 4120
            assert 'refresh' in result['error']['message']
            assert state() == before
    record['running'] = False
    for params in ({'key': 'reasoning', 'value': 'high', 'scope': 'global'},
                   {'key': 'personality', 'value': 'none', 'scope': 'global'},
                   {'key': 'fast', 'value': 'normal', 'scope': 'global'},
                   {'key': 'reasoning', 'value': 'show'}, {'key': 'fast', 'value': 'status'}):
        assert 'result' in server._methods['config.set']('set', {
            'session_id': runtime.runtime_id, 'profile': 'writer', **params})
        assert state() == before
    config = yaml.safe_load((home / 'profiles' / 'writer' / 'config.yaml').read_text())
    assert config['agent']['reasoning_effort'] == 'high'

    ordinary = server._methods['session.create']('ordinary', {
        'profile': 'reviewer', 'source': 'desktop', 'cwd': str(root)})['result']['session_id']
    other_record = server._sessions[ordinary]
    server._start_agent_build(ordinary, other_record)
    assert server._wait_agent(other_record, 'ordinary', timeout=15) is None
    assert 'result' in server._methods['config.set']('set', {
        'session_id': ordinary, 'profile': 'reviewer', 'key': 'reasoning', 'value': 'high'})
    assert other_record['agent'].reasoning_config != before[0]
    refreshed = []
    def refresh(target, **kwargs):
        refreshed.append(target)
        target.tools = [*target.tools, {'type': 'function', 'function': {'name': 'new_mcp_tool'}}]
    fake = SimpleNamespace(shutdown_mcp_servers=lambda: None, reprobe_tool_availability=lambda: None,
                           discover_mcp_tools=lambda: None, refresh_agent_mcp_tools=refresh)
    real_mod = server._tools_mod
    monkeypatch.setattr(server, '_tools_mod', lambda name:
                        fake if name.startswith('tools.mcp_tool_') else real_mod(name))
    tools_before = copy.deepcopy(agent.tools)
    assert 'result' in server._methods['reload.mcp']('reload', {'confirm': True})
    assert agent not in refreshed and other_record['agent'] in refreshed
    assert agent.tools == tools_before
    class CompletedConcurrentReload:
        def acquire(self, **kwargs):
            return False
        def __enter__(self):
            server._mcp_reload_gen += 1
        def __exit__(self, *args):
            pass
    monkeypatch.setattr(server, '_mcp_reload_lock', CompletedConcurrentReload())
    refreshed.clear()
    assert 'result' in server._methods['reload.mcp']('coalesced', {'confirm': True})
    assert agent not in refreshed and other_record['agent'] in refreshed
    assert agent.tools == tools_before


def test_preparation_reserves_managed_identity_through_binding_and_cold_recovery(runtime_env, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from gateway.hosted_room_conversation_bindings import ConversationBindings
    from tui_gateway.managed_model_runtime import get_registry
    from tui_gateway.transport import bind_transport, reset_transport
    server, store, install, home, root = runtime_env
    binding = _conversation(store, install)
    cfg_path = home / 'profiles' / 'writer' / 'config.yaml'
    cfg = yaml.safe_load(cfg_path.read_text())
    cfg['agent']['reasoning_effort'] = 'high'
    cfg['agent']['service_tier'] = 'normal'
    cfg_path.write_text(yaml.safe_dump(cfg))
    class Peer:
        auth_identity = {'provider': 'test', 'user_id': 'creator'}
        def write(self, frame):
            return True
    owner, controller = Peer(), Peer()

    def call(peer, method, **params):
        token = bind_transport(peer)
        try:
            return server._methods[method]('managed', {'profile': 'writer', **params})
        finally:
            reset_transport(token)

    def prepare(**selection):
        token = bind_transport(owner)
        try:
            return prepare_conversation_session(server, binding=binding, project=None,
                                                source='desktop', **selection)
        finally:
            reset_transport(token)

    def resolve():
        token = bind_transport(owner)
        try:
            return resolve_conversation_session(server, binding=binding, project=None, source='desktop')
        finally:
            reset_transport(token)

    def bind(sid, key):
        params = {'session_id': sid, 'model_id': 'catalog-model',
                  'owner': {'platform_origin': 'http://127.0.0.1:9', 'user_id': 'platform-user'}}
        ticket = call(owner, 'session.managed_model_ticket', **params)['result']['session_ticket']
        revision = call(controller, 'session.claim_managed_model', **params,
                        session_ticket=ticket)['result']['binding_revision']
        result = call(controller, 'session.bind_managed_model', **params, binding_revision=revision,
            model='gpt-4.1-mini', api_mode='chat_completions', credential_id='fixture', api_key=key,
            base_url='http://127.0.0.1:9/v1', capabilities={'tools': True, 'vision': False, 'reasoning': True},
            expires_at=(datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat())
        assert result['result']['bound'] is True

    first = prepare(model_source='aino', model_id='catalog-model')
    sid = first['session_id']
    record = server._sessions[sid]
    assert first['model_status'] == 'awaiting_managed_credentials'
    assert first['model_config']['model_id'] == 'catalog-model'
    assert record['agent'] is None
    assert first == prepare(model_source='aino', model_id='catalog-model')
    stored = ConversationBindings(store.db_path).resolve(binding, None)
    assert stored['lineage_id'] == first['stored_session_id']
    assert not stored['capability_digest'] and stored['system_prompt_digest'] is None
    with server._session_db(record) as db:
        row = db.get_session(first['stored_session_id'])
        assert row['profile_name'] == 'writer' and row['hidden']
        assert not row['system_prompt']
    with pytest.raises(ConversationBindingError, match='refresh'):
        prepare(model_source='aino', model_id='other-model')
    with pytest.raises(ConversationBindingError, match='awaiting_managed_credentials'):
        resolve()
    assert server._sessions[sid]['agent'] is None

    # The real scheduler must skip this reserved generation even if credentials later become ready.
    class ImmediateTimer:
        def __init__(self, delay, callback):
            self.callback = callback
        def start(self):
            self.callback()
    with monkeypatch.context() as patch:
        scheduled = []
        patch.setattr(server.threading, 'Timer', ImmediateTimer)
        patch.setattr(server, '_start_agent_build', lambda sid, record: scheduled.append(sid))
        server._schedule_agent_build(sid)
        assert not scheduled

    # Simulate process runtime loss before binding. The shared draft marker is already authoritative.
    del server._sessions[sid]
    cold = prepare()
    assert cold['stored_session_id'] == first['stored_session_id'] and cold['session_id'] != sid
    sid = cold['session_id']
    record = server._sessions[sid]
    assert record['auth_user_id'] == 'test:creator'
    assert record['source'] == 'desktop' and record['agent'] is None
    bind(sid, 'deterministic-fixture-key')
    assert prepare()['model_status'] == 'ready'
    runtime = resolve()
    assert runtime.runtime_id == sid and runtime.lineage_id == first['stored_session_id']
    assert runtime.model_snapshot['model_source'] == 'aino'
    agent = record['agent']
    assert agent.provider == 'aino' and agent._user_id == 'test:creator'
    assert runtime.model_snapshot['reasoning_config'] == agent.reasoning_config
    assert runtime.model_snapshot['service_tier'] == 'normal'
    assert ConversationBindings(store.db_path).resolve(binding, None)['system_prompt_digest'] is None
    before = (copy.deepcopy(agent.tools), copy.deepcopy(record['history']), agent._cached_system_prompt)
    bind(sid, 'renewed-fixture-key')
    assert (agent.tools, record['history'], agent._cached_system_prompt) == before
    assert resolve() == runtime

    cfg['agent']['reasoning_effort'] = 'low'
    cfg['agent']['service_tier'] = 'fast'
    cfg_path.write_text(yaml.safe_dump(cfg))
    agent.close()
    get_registry().clear_session(sid)
    del server._sessions[sid]
    recovered = prepare()
    new_sid = recovered['session_id']
    assert recovered['stored_session_id'] == first['stored_session_id']
    assert recovered['model_status'] == 'awaiting_managed_credentials'
    assert server._sessions[new_sid]['agent'] is None
    with pytest.raises(ConversationBindingError, match='awaiting_managed_credentials'):
        resolve()
    bind(new_sid, 'cold-fixture-key')
    rebuilt = resolve()
    assert rebuilt.model_snapshot == runtime.model_snapshot
    assert server._sessions[new_sid]['agent'].reasoning_config == agent.reasoning_config
    assert server._sessions[new_sid]['agent'].service_tier in (None, '')
    stranger = Peer()
    stranger.auth_identity = {'provider': 'test', 'user_id': 'stranger'}
    assert 'error' in call(stranger, 'session.resume', session_id=first['stored_session_id'])
    assert 'error' in call(owner, 'session.managed_model_ticket', session_id=new_sid,
                          model_id='other-model', owner={'platform_origin': 'http://127.0.0.1:9',
                                                        'user_id': 'platform-user'})
    old_record = server._sessions[new_sid]
    old_state = (old_record['agent'], copy.deepcopy(old_record['history']), copy.deepcopy(rebuilt.model_snapshot))
    token = bind_transport(owner)
    try:
        revision = store.get('conversation').revision
        refreshed = refresh_conversation_preparation(server, binding=binding, project=None, source='desktop')
        assert refreshed['session_generation'] == binding.session_generation + 1
        assert refreshed['stored_session_id'] != first['stored_session_id']
        assert refreshed['model_config']['model_id'] == first['model_config']['model_id']
        assert refreshed['model_status'] == 'awaiting_managed_credentials'
        assert server._sessions[refreshed['session_id']]['agent'] is None
        assert store.get('conversation').revision == revision + 1
        next_binding = replace(binding, session_generation=refreshed['session_generation'],
                               lineage_id=refreshed['stored_session_id'])
        with pytest.raises(ConversationBindingError, match='invalid'):
            refresh_conversation_preparation(server, binding=next_binding, project=None, source='desktop',
                                             model_source='aino')
        assert store.get('conversation').revision == revision + 1
        changed = refresh_conversation_preparation(server, binding=next_binding, project=None, source='desktop',
                                                   model_source='aino', model_id='other-model')
        assert changed['model_config']['model_id'] == 'other-model'
        assert server._sessions[changed['session_id']]['agent'] is None
        byok_binding = replace(binding, session_generation=changed['session_generation'],
                               lineage_id=changed['stored_session_id'])
        byok = refresh_conversation_preparation(server, binding=byok_binding, project=None, source='desktop',
                                                model_source='byok')
        assert byok['model_status'] == 'prepared'
        assert not server._sessions[byok['session_id']].get('managed_model_params')
        assert server._sessions[byok['session_id']]['agent'] is None
        assert (old_record['agent'], old_record['history'], rebuilt.model_snapshot) == old_state
    finally:
        reset_transport(token)
    for live_id in (sid, new_sid):
        get_registry().clear_session(live_id)
