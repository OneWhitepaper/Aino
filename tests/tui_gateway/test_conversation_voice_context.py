"""Live voice uses the private frozen input, never the public conversation history."""
import json
import threading
from http.server import HTTPServer

import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_history import _setup
from tests.tui_gateway.test_conversation_authority import Peer, caller


def test_voice_delegation_is_owned_replay_bound_and_private_after_service_restart(runtime_env, monkeypatch):
    from tests.agent.test_api_content_sidecar import _MockHandler
    from tui_gateway.hosted_room_service import HostedRoomService
    from tools.voice_live import voice_live_turn_note

    server, store, _, home, _ = runtime_env
    _MockHandler.captured_requests, _MockHandler.response_queue = [], []
    http = HTTPServer(('127.0.0.1', 0), _MockHandler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    cfg = yaml.safe_load((home / 'config.yaml').read_text())
    cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
    cfg['compression'] = {'enabled': False}
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    try:
        hosted, rpc, call, general = _setup(runtime_env, monkeypatch)
        call('prepare', conversation_id='c', participant_id=general)
        private = 'PRIVATE-SPOKEN-DETAIL: move the appointment to Thursday'
        params = dict(conversation_id='c', turn_id='voice-turn', input_id='voice-input',
                      participant_id=general, text='Yes, please do that.',
                      expected_revision=store.get('c').revision, surface='voice-live', voice_context=private)
        with caller(Peer('stranger')):
            assert 'error' in rpc('send', **params)
        assert not store.events('c').events
        admission = call('send', **params)['admission']
        assert call('send', **params)['admission']['idempotent']
        for change in ({'voice_context': 'different'}, {'voice_context': None, 'surface': None}):
            assert 'error' in rpc('send', **{**params, **change})
        assert voice_live_turn_note(private) in store.prepared_input('c', 'voice-input').text
        assert private not in json.dumps(call('events', conversation_id='c'))
        assert private not in json.dumps(call('get', conversation_id='c'))
        hosted = HostedRoomService(server, db_path=store.db_path)
        monkeypatch.setattr(server, 'get_conversation_service', lambda: hosted.conversations)
        assert call('retry', conversation_id='c', turn_id='voice-turn', input_id='voice-input', expected_generation=call('get', conversation_id='c')['active_turn']['execution_generation'])['admission']['idempotent']
        binding = hosted.conversations.bindings()[0]
        hosted.runtime.turn_timeout_seconds = 15
        hosted.runtime._process_room(binding)
        hosted.conversations.prepare_room(binding)
        requests = [r for r in _MockHandler.captured_requests if r.get('stream') is True and 'messages' in r]
        assert any(private in json.dumps(r['messages']) for r in requests)
        assert private not in json.dumps(call('events', conversation_id='c'))
        branch = call('branch', conversation_id='c', source_event_id=admission['event_id'],
                     expected_revision=store.get('c').revision, target_conversation_id='branch', operation_id='branch')
        assert private not in json.dumps(branch)
        assert private not in json.dumps(call('events', conversation_id='branch'))
        assert store.prepared_input('branch', 'voice-input') is None
    finally:
        http.shutdown()
        thread.join(timeout=3)
        http.server_close()


def test_voice_context_limits_refuse_atomically_and_meter_private_retained_bytes(runtime_env, monkeypatch):
    from gateway import hosted_rooms
    from gateway.hosted_room_conversation_budget import usage

    _, store, _, home, _ = runtime_env
    _, rpc, call, general = _setup(runtime_env, monkeypatch)
    call('prepare', conversation_id='c', participant_id=general)
    params = dict(conversation_id='c', turn_id='v', input_id='v', participant_id=general,
                  text='continue', expected_revision=store.get('c').revision,
                  surface='voice-live', voice_context='私密😀' * 800)
    for change in ({'voice_context': 'x' * 6001}, {'surface': None}):
        assert 'error' in rpc('send', **{**params, **change})
    cfg = yaml.safe_load((home / 'config.yaml').read_text())
    cfg['conversations']['storage'] = {'max_content_bytes': 1, 'max_conversation_bytes': 270000}
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    assert 'error' in rpc('send', **params)
    assert not store.events('c').events
    with hosted_rooms._transaction(store.db_path) as conn:
        assert not conn.execute('SELECT 1 FROM hosted_conversation_output_reservations').fetchone()
        assert not conn.execute('SELECT 1 FROM hosted_conversation_history_storage').fetchone()
    cfg['conversations']['storage']['max_conversation_bytes'] = 500000
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    call('send', **params)
    with hosted_rooms._transaction(store.db_path) as conn:
        retained = conn.execute('SELECT bytes FROM hosted_conversation_history_storage WHERE conversation_id=?', ('c',)).fetchone()[0]
        envelope_json = conn.execute('SELECT envelope_json FROM hosted_conversation_prepared_inputs WHERE conversation_id=?', ('c',)).fetchone()[0]
        payload_json = conn.execute('SELECT payload_json FROM hosted_room_driver_tasks WHERE room_id=?', ('c',)).fetchone()[0]
        assert retained == len(envelope_json.encode()) + len(payload_json.encode())
        assert usage(conn, 'c') >= retained + 256 * 1024
