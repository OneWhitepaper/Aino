"""Ordinary conversation RPCs drive real Profile agents against a deterministic HTTP provider."""

from __future__ import annotations

import io
import json
import re
import queue
import threading
from http.server import HTTPServer, ThreadingHTTPServer

import yaml
import pytest

from tests.agent.test_api_content_sidecar import _MockHandler, _text_resp, _tc_resp
from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


def test_general_writer_reviewer_general_writer_keeps_public_history_and_private_prefixes(runtime_env, monkeypatch):
    from gateway import hosted_room_driver as driver
    from hermes_cli import projects_db
    from tui_gateway.hosted_room_service import HostedRoomService

    server, store, install, home, root = runtime_env
    frames = []
    class Sink:
        def write(self, frame):
            frames.append(frame)
            return True
    monkeypatch.setattr(server, '_stdio_transport', Sink())
    monkeypatch.setattr(server, '_emit', lambda event, sid, payload=None:
        server.write_json(server._event_frame(event, sid, payload)))
    replies = ('General opening', 'Writer scene', 'Reviewer critique', 'General author recap', 'Writer revision')

    class Provider(_MockHandler):
        captured_requests = []
        response_queue = []

        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            request = json.loads(body)
            messages = request.get('messages', [])
            main = any(message.get('role') == 'system' and 'identity-marker' in str(message.get('content'))
                       for message in messages)
            match = re.search(r'<request_text>Request (\d+)</request_text>', str(messages[-1].get('content'))) if messages else None
            type(self).response_queue = [_text_resp(replies[int(match[1])] if main and match else 'Novel')]
            self.rfile = io.BytesIO(body)
            super().do_POST()

    http = HTTPServer(('127.0.0.1', 0), Provider)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    models = {'default': 'gpt-4.1-mini', 'writer': 'gpt-4.1', 'reviewer': 'gpt-4.1-nano'}
    for profile, model in models.items():
        profile_home = home if profile == 'default' else home / 'profiles' / profile
        cfg_path = profile_home / 'config.yaml'
        cfg = yaml.safe_load(cfg_path.read_text())
        cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
        cfg['model']['default'] = model
        cfg['compression'] = {'enabled': False}
        cfg['agent']['system_prompt'] = f'Private instruction belonging to {profile}.'
        cfg_path.write_text(yaml.safe_dump(cfg))
        (profile_home / 'SOUL.md').write_text(f'Private persona {profile}: private-{profile}-identity-marker.')
    project_dir = root / 'novel'
    project_dir.mkdir()
    (project_dir / 'AGENTS.md').write_text('Project rule: every scene takes place in Lake Town.')
    (project_dir / 'notes.txt').write_text('The protagonist is Mira.')
    with projects_db.connect_closing(home / 'projects.db') as conn:
        project_id = projects_db.create_project(conn, name='Novel', primary_path=str(project_dir))
    project = dict(install_id=install, registration_profile='default', project_id=project_id,
                   cwd=str(project_dir), execution_environment_id='local')
    hosted = HostedRoomService(server, db_path=store.db_path)
    service = hosted.conversations
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)

    def call(method, **params):
        result = server._methods['conversations.' + method]('e2e', params)
        assert 'error' not in result, result
        return result['result']

    try:
        participants = {r['participant']['profile']: r['participant']['participant_id']
                        for r in call('participants')['participants']}
        call('create', conversation_id='shared-novel', title='Novel',
             general_participant_id=participants['default'], project_ref=project)
        profiles = ('default', 'writer', 'reviewer', 'default', 'writer')
        prefixes = {}
        for index, (profile, reply) in enumerate(zip(profiles, replies)):
            before = call('get', conversation_id='shared-novel')['conversation']
            admission = call('send', conversation_id='shared-novel', turn_id=f't{index}', input_id=f'i{index}',
                             participant_id=participants[profile], text=f'Request {index}',
                             expected_revision=before['revision'])['admission']
            room = service.bindings()[0]
            hosted.runtime.turn_timeout_seconds = 15
            hosted.runtime._process_room(room)
            service.prepare_room(room)
            task = next(t for t in driver.list_tasks(store.db_path, room_id='shared-novel')
                        if t['identity'].turn_id == f't{index}')
            assert task['status'] == 'settled', task
            completed = [frame['params'] for frame in frames if frame.get('method') == 'event'
                         and frame['params'].get('type') == 'message.complete'
                         and frame['params'].get('conversation', {}).get('turn_id') == f't{index}']
            assert len(completed) == 1
            assert completed[0]['conversation']['participant_id'] == participants[profile]
            assert completed[0]['conversation']['execution_generation'] == task['execution_generation']
            current = call('get', conversation_id='shared-novel')['conversation']
            assert current['conversation_id'] == before['conversation_id']
            assert current['project'] == project
            session = next(record for record in server._sessions.values()
                           if record.get('_conversation_binding', {}).get('participant_id') == participants[profile])
            agent = session['agent']
            assert agent.model == models[profile] and session['cwd'] == str(project_dir)
            prefix = agent._cached_system_prompt
            if profile in prefixes:
                assert prefix == prefixes[profile]
            prefixes[profile] = prefix
            assert f'private-{profile}-identity-marker' in prefix
            assert 'Lake Town' in prefix
            for other in set(profiles) - {profile}:
                assert f'private-{other}-identity-marker' not in prefix
            receipt = agent._session_db.get_conversation_input_receipt(f'i{index}')
            assert receipt is not None
            envelope = store.prepared_input('shared-novel', f'i{index}')
            assert receipt.input_digest == envelope.input_digest
            assert admission['event_id'] in store.context_coverage(next(
                b for b in store.participants('shared-novel') if b.participant.participant_id == participants[profile]
            )).received_event_ids
        public = call('events', conversation_id='shared-novel')['events']
        answers = [e for e in public if e['kind'] == 'conversation.response']
        assert [e['payload']['text'] for e in answers] == list(replies)
        assert [e['actor']['id'] for e in answers] == [participants[p] for p in profiles]
        returning_writer = store.prepared_input('shared-novel', 'i4')
        assert answers[2]['event_id'] in returning_writer.source_event_ids
        assert answers[1]['event_id'] not in returning_writer.source_event_ids
        assert 'Reviewer critique' in returning_writer.text and 'Writer scene' not in returning_writer.text
        general_recap = store.prepared_input('shared-novel', 'i3')
        assert participants['writer'] in general_recap.text and participants['reviewer'] in general_recap.text
        assert 'Writer scene' in general_recap.text and 'Reviewer critique' in general_recap.text
        bindings = store.participants('shared-novel')
        assert len(bindings) == 3 and len({b.lineage_id for b in bindings}) == 3
        assert len(call('list')['conversations']) == 1
        wire = [request for request in Provider.captured_requests if request.get('messages')]
        assert any('Reviewer critique' in str(request['messages']) and request['model'] == models['writer']
                   for request in wire)
        # Resume a participant after dropping its actual live agent. Its own model
        # history and persisted prompt must survive independently from public history.
        writer_sid, writer_session = next((sid, record) for sid, record in server._sessions.items()
            if record.get('_conversation_binding', {}).get('participant_id') == participants['writer'])
        lineage = writer_session['_conversation_binding']['lineage_id']
        writer_session['agent'].close()
        assert server._release_active_session_slot(writer_session)
        del server._sessions[writer_sid]
        revision = call('get', conversation_id='shared-novel')['conversation']['revision']
        call('send', conversation_id='shared-novel', turn_id='restart-turn', input_id='restart-input',
             participant_id=participants['writer'], text='Request 4', expected_revision=revision)
        hosted.runtime._process_room(service.bindings()[0])
        service.prepare_room(service.bindings()[0])
        restored = next(record for record in server._sessions.values()
            if record.get('_conversation_binding', {}).get('participant_id') == participants['writer'])
        assert restored['_conversation_binding']['lineage_id'] == lineage
        assert restored['agent']._cached_system_prompt == prefixes['writer']
        restored_task = next(t for t in driver.list_tasks(store.db_path, room_id='shared-novel')
                            if t['identity'].turn_id == 'restart-turn')
        assert restored_task['status'] == 'settled', restored_task
        assert restored['agent']._session_db.get_conversation_input_receipt('restart-input') is not None
    finally:
        hosted.stop(timeout=1)
        http.shutdown()
        http.server_close()
        worker.join(timeout=2)


def test_model_can_use_real_terminal_and_automatically_delegate_inside_conversation(runtime_env, monkeypatch):
    from hermes_cli import projects_db
    from tui_gateway.hosted_room_service import HostedRoomService
    from tools import async_delegation
    from tools.process_registry import process_registry
    from tools.process_registry_notifications import format_process_notification

    server, store, install, home, root = runtime_env
    captured, frames = [], []

    class Provider(_MockHandler):
        captured_requests = []
        response_queue = []

        def do_GET(self):  # noqa: N802
            if self.path not in ('/v1/models', '/models'):
                self.send_error(404)
                return
            body = json.dumps({'data': [{'id': 'gpt-4.1-mini', 'context_length': 128000,
                'pricing': {'prompt': '0.000001', 'completion': '0.000002'}}]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            request = json.loads(body)
            captured.append(request)
            messages = request.get('messages', [])
            names = {tool['function']['name'] for tool in request.get('tools', [])}
            latest_user = next((str(message.get('content')) for message in reversed(messages)
                                if message.get('role') == 'user'), '')
            tool_results = [message for message in messages if message.get('role') == 'tool']
            child = 'CHILD_MARKER' in latest_user and 'delegate_task' not in names
            if not names:
                response = _text_resp('Tool check')
            elif not child and 'Child verified the project note' in latest_user:
                response = _text_resp('Main received the child result')
            elif child:
                response = (_text_resp('Child verified the project note') if tool_results else
                    _tc_resp('terminal', json.dumps({'command': 'cat child-note.txt'})))
            elif not tool_results:
                response = _tc_resp('terminal', json.dumps({'command': 'cat parent-note.txt'}))
            elif len(tool_results) == 1:
                response = _tc_resp('delegate_task', json.dumps({
                    'goal': 'CHILD_MARKER Read child-note.txt in the project and report its contents.',
                    'toolsets': ['terminal'], 'background': False}))
            else:
                response = _text_resp('Main terminal and delegated child completed')
            if response['choices'][0]['message'].get('tool_calls'):
                response['choices'][0]['message']['tool_calls'][0]['id'] = f'call-{child}-{len(tool_results)}'
            response['usage'] = {'prompt_tokens': 1000, 'completion_tokens': 100, 'total_tokens': 1100}
            if request.get('stream'):
                delta = dict(response['choices'][0]['message'])
                if delta.get('tool_calls'):
                    delta['tool_calls'] = [dict(call, index=i) for i, call in enumerate(delta['tool_calls'])]
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                chunks = [
                    {'id': 'metered', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]},
                    {'id': 'metered', 'choices': [{'index': 0, 'delta': {},
                     'finish_reason': response['choices'][0]['finish_reason']}]},
                    {'id': 'metered', 'choices': [], 'usage': response['usage']},
                ]
                for chunk in chunks:
                    self.wfile.write(f'data: {json.dumps(chunk)}\n\n'.encode())
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
                return
            # Each handler owns its response queue; parent and actual child share this HTTP boundary.
            self.__class__ = type('RequestHandler', (Provider,), {'response_queue': [response], 'captured_requests': []})
            self.rfile = io.BytesIO(body)
            _MockHandler.do_POST(self)

    http = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    config_path = home / 'profiles' / 'writer' / 'config.yaml'
    config = yaml.safe_load(config_path.read_text())
    config['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
    config['toolsets'] = ['terminal', 'delegation']
    config['compression'] = {'enabled': False}
    config['delegation'] = {'max_iterations': 5, 'child_timeout_seconds': 30}
    config_path.write_text(yaml.safe_dump(config))
    project = root / 'tool-project'
    project.mkdir()
    (project / 'parent-note.txt').write_text('PARENT_CONTENT_UNIQUE')
    (project / 'child-note.txt').write_text('CHILD_CONTENT_UNIQUE')
    with projects_db.connect_closing(home / 'projects.db') as conn:
        project_id = projects_db.create_project(conn, name='Tool project', primary_path=str(project))
    project_ref = dict(install_id=install, registration_profile='default', project_id=project_id,
                       cwd=str(project), execution_environment_id='local')
    class Sink:
        def write(self, frame):
            frames.append(frame)
            return True
    monkeypatch.setattr(server, '_stdio_transport', Sink())
    monkeypatch.setattr(server, '_emit', lambda event, sid, payload=None:
        server.write_json(server._event_frame(event, sid, payload)))
    hosted = HostedRoomService(server, db_path=store.db_path)
    service = hosted.conversations
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    async_delegation._reset_for_tests()
    completed_events = []
    from tools import delegate_tool_results
    rollups = []
    rollup = delegate_tool_results._rollup_children_cost
    def observe_rollup(parent, cost):
        before = parent.session_estimated_cost_usd
        rollup(parent, cost)
        rollups.append((parent, cost, parent.session_estimated_cost_usd - before))
    monkeypatch.setattr(delegate_tool_results, '_rollup_children_cost', observe_rollup)
    completion_finalized = threading.Event()
    finalize = async_delegation._finalize

    class ObservedMailbox(queue.Queue):
        def put(self, event, *args, **kwargs):
            if event.get('type') == 'async_delegation':
                completed_events.append(event)
            return super().put(event, *args, **kwargs)

    def observe_finalization(*args, **kwargs):
        finalize(*args, **kwargs)
        completion_finalized.set()

    mailbox = ObservedMailbox()
    monkeypatch.setattr(async_delegation, '_finalize', observe_finalization)
    monkeypatch.setattr(process_registry, 'completion_queue', mailbox)
    try:
        general = next(row['participant']['participant_id'] for row in service.catalog() if row['participant']['is_general'])
        created = service.create('tool-proof', 'Tool proof', general, project_ref)['conversation']
        participants = {row['participant']['profile']: row['participant']['participant_id']
                        for row in service.catalog()}
        writer = participants['writer']
        service.send('tool-proof', 'tool-turn', 'tool-input', writer, 'Run the project tool and child check.', created['revision'])
        # Preparation is the backend consequence of selecting B/General while
        # A owns the admitted turn; accounting never receives mutable UI state.
        for profile in ('reviewer', 'default'):
            service.prepare('tool-proof', participants[profile])
        room = service.bindings()[0]
        hosted.runtime.turn_timeout_seconds = 40
        hosted.runtime._process_room(room)
        service.prepare_room(room)
        task = service._tasks('tool-proof')[0]
        assert task['status'] == 'settled', task
        # The real post-turn drain can consume a fast child's event before this
        # test reaches it. Observe publication without competing for the queue;
        # replaying that same event below also verifies idempotent admission.
        assert completion_finalized.wait(timeout=20)
        assert len(completed_events) == 1
        event = completed_events[0]
        assert event['type'] == 'async_delegation'
        sid, session = next((sid, s) for sid, s in server._sessions.items()
                            if s.get('_conversation_binding', {}).get('participant_id') == writer)
        assert server._notif_handle_event(sid, session, event, set(), process_registry,
                                         format_process_notification, [], owned=False)
        service.prepare_room(room)
        hosted.runtime._process_room(room)
        service.prepare_room(room)
        assert all(row['status'] == 'settled' for row in service._tasks('tool-proof'))
        terminal_results = [str(message.get('content')) for request in captured
                            for message in request.get('messages', []) if message.get('role') == 'tool']
        assert any('PARENT_CONTENT_UNIQUE' in value for value in terminal_results), terminal_results
        assert any('CHILD_CONTENT_UNIQUE' in value for value in terminal_results), terminal_results
        assert any('Child verified the project note' in str(message.get('content')) for request in captured
                   for message in request.get('messages', []) if message.get('role') == 'user')
        child_starts = [frame['params'] for frame in frames if frame.get('method') == 'event'
                        and frame['params'].get('type') == 'subagent.start']
        assert child_starts and all(e['conversation']['turn_id'] == 'tool-turn' for e in child_starts)
        public = service.events('tool-proof')['events']
        responses = [e for e in public if e['kind'] == 'conversation.response']
        assert [e['payload']['text'] for e in responses] == [
            'Main terminal and delegated child completed', 'Main received the child result']
        assert 'CHILD_CONTENT_UNIQUE' not in json.dumps(public)
        assert session['agent']._session_db.get_conversation_input_receipt('tool-input') is not None
        child_finishes = [frame['params'] for frame in frames if frame.get('method') == 'event'
                          and frame['params'].get('type') == 'subagent.complete']
        assert len(child_finishes) == 1
        child_usage = child_finishes[0]['payload']
        assert child_usage['input_tokens'] > 0 and child_usage['output_tokens'] > 0
        assert len(rollups) == 1
        charged_parent, child_cost, increment = rollups[0]
        assert child_cost > 0 and increment == pytest.approx(child_cost)
        assert charged_parent is session['agent']
        assert child_finishes[0]['conversation']['participant_id'] == writer
        agent = session['agent']
        assert agent.session_prompt_tokens == 1000 * agent.session_api_calls > 0
        assert agent.session_output_tokens == 100 * agent.session_api_calls > 0
        child_row = agent._session_db.get_session(child_usage['child_session_id'])
        assert child_row['parent_session_id'] == agent.session_id
        assert child_row['input_tokens'] == child_usage['input_tokens']
        assert child_row['output_tokens'] == child_usage['output_tokens']
        assert child_row['estimated_cost_usd'] == pytest.approx(child_cost)
        # The excess over actual parent API usage must equal real child spend.
        from agent.usage_pricing import CanonicalUsage, estimate_usage_cost
        parent_cost = estimate_usage_cost(agent.model, CanonicalUsage(
            input_tokens=agent.session_prompt_tokens, output_tokens=agent.session_output_tokens),
            provider=agent.provider, base_url=agent.base_url)
        assert agent.session_estimated_cost_usd == pytest.approx(
            float(parent_cost.amount_usd) + child_cost)
        uncharged = [other for other in server._sessions.values()
                     if other.get('_conversation_binding', {}).get('participant_id')
                     in (general, participants['reviewer'])]
        assert len(uncharged) == 2
        for other in uncharged:
            assert other['agent'] is None
            with server._session_db(other) as db:
                row = db.get_session(other['session_key'])
                assert not row['input_tokens'] and not row['output_tokens']
                assert not row['estimated_cost_usd']
        usage_frames = [frame['params'] for frame in frames if frame.get('method') == 'event'
                        and frame['params'].get('type') == 'message.complete']
        assert usage_frames and all(e['conversation']['participant_id'] == writer for e in usage_frames)
    finally:
        hosted.stop(timeout=1)
        async_delegation._reset_for_tests()
        http.shutdown()
        http.server_close()
        worker.join(timeout=3)
