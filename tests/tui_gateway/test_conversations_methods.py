"""Registered conversation RPCs preserve atomic inputs and exact recipient routing."""
from __future__ import annotations

import pytest


def test_registered_contract_and_atomic_admission(tmp_path, monkeypatch):
    from tui_gateway import server
    from tui_gateway.conversation_service import ConversationService
    home = tmp_path / '.hermes'
    home.mkdir()
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(server, '_hermes_home', home)
    service = ConversationService(server, db_path=home / 'shared-state.db')
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    def call(name, params):
        return server._methods['conversations.' + name]('test', params)
    assert call('capabilities', {})['result']['enabled'] is False
    assert call('create', {'conversation_id': 'c', 'title': 'Work',
                           'general_participant_id': 'bad', 'profile': '/arbitrary'})['error']['code'] == 4000
    catalog = call('participants', {})['result']['participants']
    general = next(row['participant'] for row in catalog if row['participant']['is_general'])
    disabled = call('create', {'conversation_id': 'c', 'title': 'Work',
                               'general_participant_id': general['participant_id']})
    assert 'error' in disabled
    assert call('list', {})['result']['conversations'] == []
    (home / 'config.yaml').write_text('conversations:\n  enabled: true\n')
    assert call('capabilities', {})['result']['enabled'] is True
    created = call('create', {'conversation_id': 'c', 'title': 'Work',
                              'general_participant_id': general['participant_id']})['result']['conversation']
    invalid = call('send', {'conversation_id': 'c', 'turn_id': 't', 'input_id': 'i',
                           'participant_id': 'deleted', 'text': 'draft',
                           'expected_revision': created['revision']})
    assert 'error' in invalid
    before = call('events', {'conversation_id': 'c'})['result']
    assert not [e for e in before['events']
                if e['kind'] == 'conversation.input']
    (home / 'config.yaml').write_text('conversations:\n  enabled: false\n')
    assert call('get', {'conversation_id': 'c'})['result']['conversation'] == created
    assert call('events', {'conversation_id': 'c'})['result'] == before


def test_capability_uses_install_config_not_selected_profile(runtime_env):
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from tui_gateway.conversation_service import ConversationService
    server, store, _install, home, _root = runtime_env
    service = ConversationService(server, db_path=store.db_path)
    token = set_hermes_home_override(home / 'profiles' / 'writer')
    try:
        assert service.capabilities()['enabled'] is True
        (home / 'config.yaml').write_text('conversations:\n  enabled: false\n')
        assert service.capabilities()['enabled'] is False
        (home / 'config.yaml').write_text('conversations:\n  enabled: "true"\n')
        assert service.capabilities()['enabled'] is False
    finally:
        reset_hermes_home_override(token)


from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: E402,F401


@pytest.mark.parametrize('managed', [False, True])
def test_real_runtime_admission_replay_receipt_and_publication(runtime_env, monkeypatch, managed):
    import threading
    from http.server import HTTPServer
    import yaml
    from tests.agent.test_api_content_sidecar import _MockHandler
    from tui_gateway.hosted_room_service import HostedRoomService
    from gateway import hosted_room_driver as driver
    from tui_gateway.transport import bind_transport, reset_transport
    from tui_gateway.managed_model_runtime import get_registry
    from datetime import datetime, timedelta, timezone

    class Peer:
        auth_identity = {'provider': 'test', 'user_id': 'creator'}
        def write(self, frame):
            return True
    owner, controller = Peer(), Peer()
    owner_token = bind_transport(owner)
    server, store, install, home, root = runtime_env
    _MockHandler.captured_requests = []
    _MockHandler.response_queue = []
    http = HTTPServer(('127.0.0.1', 0), _MockHandler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    for cfg_path in (home / 'config.yaml', home / 'profiles' / 'writer' / 'config.yaml'):
        cfg = yaml.safe_load(cfg_path.read_text())
        cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
        cfg['compression'] = {'enabled': False}
        cfg_path.write_text(yaml.safe_dump(cfg))
    hosted = HostedRoomService(server, db_path=store.db_path)
    service = hosted.conversations
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    def call(method, **params):
        envelope = server._methods['conversations.' + method]('test', params)
        assert 'error' not in envelope, envelope
        return envelope['result']
    def bind_model(sid):
        params = {'session_id': sid, 'profile': 'writer', 'model_id': 'catalog-model',
                  'owner': {'platform_origin': f'http://127.0.0.1:{http.server_port}', 'user_id': 'platform-user'}}
        ticket = server._methods['session.managed_model_ticket']('ticket', params)['result']['session_ticket']
        token = bind_transport(controller)
        try:
            claim = server._methods['session.claim_managed_model']('claim', {**params, 'session_ticket': ticket})
            result = server._methods['session.bind_managed_model']('bind', {**params,
                'binding_revision': claim['result']['binding_revision'], 'model': 'gpt-4.1-mini',
                'api_mode': 'chat_completions', 'credential_id': 'fixture', 'api_key': 'local-test-key',
                'base_url': f'http://127.0.0.1:{http.server_port}/v1',
                'capabilities': {'tools': True, 'vision': False, 'reasoning': True},
                'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()})
            assert result['result']['bound'] is True
        finally:
            reset_transport(token)

    try:
        catalog = call('participants')['participants']
        general = next(r['participant']['participant_id'] for r in catalog if r['participant']['is_general'])
        writer = next(r['participant']['participant_id'] for r in catalog if r['participant']['profile'] == 'writer')
        created = call('create', conversation_id='c', title='Work', general_participant_id=general)['conversation']
        prepared = call('prepare', conversation_id='c', participant_id=writer, expected_generation=1,
                        **({'model_source': 'aino', 'model_id': 'catalog-model'} if managed else {}))
        prepared_again = call('prepare', conversation_id='c', participant_id=writer, expected_generation=1)
        assert prepared_again['session_id'] == prepared['session_id']
        assert prepared['profile'] == 'writer' and not _MockHandler.captured_requests
        if managed:
            assert prepared['model_status'] == 'awaiting_managed_credentials'
            bind_model(prepared['session_id'])
            assert call('prepare', conversation_id='c', participant_id=writer)['model_status'] == 'ready'
        created = call('get', conversation_id='c')['conversation']
        request = dict(conversation_id='c', turn_id='t', input_id='i', participant_id=writer,
                       text='Hello', expected_revision=created['revision'])
        admission = call('send', **request)['admission']
        assert call('send', **request)['admission']['event_id'] == admission['event_id']
        assert 'error' in server._methods['conversations.send']('changed', {**request, 'text': 'Different'})
        latest = call('get', conversation_id='c')['conversation']['revision']
        busy = server._methods['conversations.send']('busy', {**request, 'turn_id': 't2', 'input_id': 'i2',
                                                            'expected_revision': latest})
        assert busy['error']['data']['reason'] == 'busy'
        # A queued input has not executed: reconnect restores its exact generation before retry.
        original_sid = prepared['session_id']
        server._sessions[original_sid]['agent'].close()
        get_registry().clear_session(original_sid)
        del server._sessions[original_sid]
        cold = call('prepare', conversation_id='c', participant_id=writer, expected_generation=1)
        assert cold['stored_session_id'] == prepared['stored_session_id']
        if managed:
            assert cold['model_status'] == 'awaiting_managed_credentials'
            bind_model(cold['session_id'])
        retried = call('retry', conversation_id='c', turn_id='t', input_id='i', expected_generation=0)
        assert retried['admission']['event_id'] == admission['event_id']
        binding = service.bindings()[0]
        task = driver.list_tasks(store.db_path, room_id='c')[0]
        # The actual prompt.submit, agent turn and Profile flush run on a real HTTP provider boundary.
        hosted.runtime.turn_timeout_seconds = 15
        hosted.runtime._process_room(binding)
        task = driver.get_task(store.db_path, task['identity'])
        assert task['status'] == 'settled', task
        hosted.conversations.prepare_room(binding)
        responses = [e for e in call('events', conversation_id='c')['events'] if e['kind'] == 'conversation.response']
        assert len(responses) == 1 and responses[0]['payload']['text'] == 'DONE'
        model_snapshot = responses[0]['payload']['model_snapshot']
        session = server._sessions[cold['session_id']]
        assert model_snapshot['model'] == session['agent'].model
        assert set(model_snapshot) == {'model', 'provider', 'model_source', 'model_id'}
        assert model_snapshot['model_id'] == ('catalog-model' if managed else None)
        # Profile edits cannot relabel a durable answer or its still-live generation.
        cfg_path = home / 'profiles' / 'writer' / 'config.yaml'
        cfg = yaml.safe_load(cfg_path.read_text())
        cfg['model']['default'] = 'different-next-generation'
        cfg_path.write_text(yaml.safe_dump(cfg))
        assert call('runtime_snapshot', conversation_id='c', participant_id=writer,
                    session_generation=1)['model_snapshot'] == model_snapshot
        service.publish_terminal(binding, task)
        assert next(e for e in call('events', conversation_id='c')['events']
                    if e['kind'] == 'conversation.response')['payload']['model_snapshot'] == model_snapshot
        assert len([e for e in store.events('c').events if e['kind'] == 'conversation.response']) == 1
        # An upgrade must not backfill or conflict with previously published unknown metadata.
        import json
        from gateway import hosted_rooms
        legacy = dict(responses[0]['payload'])
        legacy.pop('model_snapshot')
        with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
            conn.execute('UPDATE hosted_room_events SET payload_json=? WHERE room_id=? AND event_id=?',
                         (json.dumps(legacy), 'c', responses[0]['event_id']))
        service.publish_terminal(binding, task)
        assert 'model_snapshot' not in next(e for e in store.events('c').events
                                           if e['kind'] == 'conversation.response')['payload']

        envelope = store.prepared_input('c', 'i')
        session = next(s for s in server._sessions.values() if s.get('_conversation_binding', {}).get('participant_id') == writer)
        receipt = session['agent']._session_db.get_conversation_input_receipt('i')
        assert receipt.input_digest == envelope.input_digest
        participant = next(b for b in store.participants('c') if b.participant.participant_id == writer)
        assert admission['event_id'] in store.context_coverage(participant).received_event_ids
        with server._session_db(session) as db:
            assert len([m for m in db.get_messages(session['session_key']) if m['role'] == 'user']) == 1
        assert _MockHandler.captured_requests
        # Crash after Profile durability but before shared ACK repairs coverage without a model replay.
        from gateway import hosted_rooms
        from tui_gateway.conversation_transport import conversation_input_scope
        from agent.conversation_input import ConversationInputRecoveryRequired
        with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
            conn.execute("DELETE FROM hosted_conversation_input_acks WHERE input_id='i'")
        calls = len(_MockHandler.captured_requests)
        with pytest.raises(ConversationInputRecoveryRequired):
            with conversation_input_scope(server, session, session['agent']):
                pytest.fail('already persisted input must not run the agent again')
        assert admission['event_id'] in store.context_coverage(participant).received_event_ids
        assert len(_MockHandler.captured_requests) == calls
        # Atomic failure after public append rolls back the input, envelope and task together.
        revision = store.get('c').revision
        old = driver._admit_task_locked
        def reject(*args, **kwargs):
            raise driver.TaskConflictError('injected conflict')
        monkeypatch.setattr(driver, '_admit_task_locked', reject)
        fail = server._methods['conversations.send']('failed', {**request, 'turn_id': 't2', 'input_id': 'i2',
                                                              'expected_revision': revision})
        assert 'error' in fail
        assert store.prepared_input('c', 'i2') is None
        assert len(driver.list_tasks(store.db_path, room_id='c')) == 1
        assert len([e for e in store.events('c').events if e['kind'] == 'conversation.input']) == 1
        monkeypatch.setattr(driver, '_admit_task_locked', old)
        from gateway.hosted_room_conversation_context import ContextBudgetError
        import tui_gateway.conversation_service as service_module
        def refuse_summary(*args, **kwargs):
            raise ContextBudgetError('summary could not be completed')
        original_prepare = service_module.prepare_turn_envelope
        monkeypatch.setattr(service_module, 'prepare_turn_envelope', refuse_summary)
        refused = server._methods['conversations.send']('summary', {**request, 'turn_id': 't3', 'input_id': 'i3',
                                                                   'expected_revision': store.get('c').revision})
        assert 'error' in refused and store.prepared_input('c', 'i3') is None
        assert len(driver.list_tasks(store.db_path, room_id='c')) == 1
        assert len([e for e in store.events('c').events if e['kind'] == 'conversation.input']) == 1
        monkeypatch.setattr(service_module, 'prepare_turn_envelope', original_prepare)
        # A provider still running after interrupt acknowledgement cannot be reported stopped.
        arrived, release = threading.Event(), threading.Event()
        original_post = _MockHandler.do_POST
        def held_post(handler):
            arrived.set()
            assert release.wait(10)
            original_post(handler)
        monkeypatch.setattr(_MockHandler, 'do_POST', held_post)
        with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
            conn.execute("DELETE FROM hosted_conversation_input_acks WHERE input_id='i'")
        call('send', **{**request, 'turn_id': 'stop-turn', 'input_id': 'stop-input',
                       'expected_revision': store.get('c').revision})
        assert admission['event_id'] not in store.prepared_input('c', 'stop-input').source_event_ids
        worker = threading.Thread(target=hosted.runtime._process_room, args=(binding,), daemon=True)
        worker.start()
        try:
            assert arrived.wait(5)
            active = call('get', conversation_id='c')['active_turn']
            stopped = call('stop', conversation_id='c', turn_id='stop-turn',
                           execution_generation=active['execution_generation'])
            assert stopped['status'] == 'requested'
        finally:
            release.set()
            worker.join(10)
        assert not worker.is_alive()
        stopped = call('stop', conversation_id='c', turn_id='stop-turn',
                       execution_generation=active['execution_generation'])
        assert stopped['status'] == 'confirmed'
        # Explicit refresh reserves new billing/model selection while the old cached runtime is unchanged.
        import copy
        old_agent = session['agent']
        old = (copy.deepcopy(old_agent.tools), old_agent._cached_system_prompt, old_agent.model)
        changed = call('refresh', conversation_id='c', participant_id=writer, expected_generation=1,
                       model_source='aino', model_id='new-catalog-model')
        assert changed['binding']['session_generation'] == 2
        assert changed['preparation']['model_config']['model_id'] == 'new-catalog-model'
        assert changed['preparation']['model_status'] == 'awaiting_managed_credentials'
        byok = call('refresh', conversation_id='c', participant_id=writer, expected_generation=2,
                    model_source='byok')
        assert byok['binding']['session_generation'] == 3
        assert byok['preparation']['model_config'].get('model_source') != 'aino'
        assert byok['preparation']['session_id'] != changed['preparation']['session_id']
        assert (old_agent.tools, old_agent._cached_system_prompt, old_agent.model) == old
    finally:
        reset_transport(owner_token)
        for sid in tuple(server._sessions):
            get_registry().clear_session(sid)
        hosted.stop(timeout=1)
        http.shutdown()
        http.server_close()
        thread.join(timeout=2)
