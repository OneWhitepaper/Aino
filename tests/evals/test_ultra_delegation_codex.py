"""Native Codex transport probes use isolated homes and loopback responses only."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shlex
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


_REPO = Path(__file__).resolve().parents[2]
_BOOTSTRAP = r'''
import hashlib, json, socket, sys, time
from pathlib import Path
from types import SimpleNamespace
def local_only(event, args):
    if event == 'socket.getaddrinfo':
        host = args[0]
    elif event == 'socket.connect' and args[0].family in (socket.AF_INET, socket.AF_INET6):
        host = args[1][0]
    else:
        return
    if host not in (None, 'localhost', '127.0.0.1', '::1'):
        raise OSError('Codex transport test forbids external network access')
sys.addaudithook(local_only)
from evals.ultra_delegation.codex_driver import run_codex
run, codex, mode, options = sys.argv[1:]
options = json.loads(options)
run = Path(run)
workspace = run / 'workspace'
workspace.mkdir(parents=True)
fixture_path = 'agent/compaction_display.py' if options.get('scenario', 'large') == 'large' else 'auth.py'
(workspace / fixture_path).parent.mkdir(parents=True, exist_ok=True)
(workspace / fixture_path).write_text('# Local transport fixture\n')
if options.get('native_counterexample'):
    (workspace / 'oldlog').write_text('Ran 2 tests in 0.001s\n\nOK\n')
    (workspace / 'test_async_native.py').write_text('import unittest\nclass Smoke(unittest.TestCase):\n    def test_local(self):\n        self.assertEqual(1, 1)\n')
live = mode == 'live'
lease = json.loads(sys.stdin.readline()) if live else None
lease_secrets = [lease['api_key']] if lease else []
def safe(value):
    data = json.dumps(value, default=str)
    for secret in tuple(lease_secrets):
        data = data.replace(secret, '[REDACTED]')
    return data
def record(kind, **values):
    with (run / 'events.jsonl').open('a') as output:
        output.write(safe({'kind': kind, **values}) + '\n')
def progress(stage, **values):
    print(safe({'stage': stage, **values}), flush=True)
def hashes(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}
args = SimpleNamespace(budget=options.get('budget', 45), live=live, codex_bin=codex, codex_dry_case='tools',
    codex_native_comparison=True, matched_comparison=False,
    review_skill='none' if options.get('scenario', 'large') == 'large' else 'original',
    scenario=options.get('scenario', 'large'), spend_target=None)
runtime = {'scenario': args.scenario, 'request_limit': 64,
    'input_limit': options.get('input_limit', 2_000_000), 'output_limit': 60_000,
    'budget_target_usd': 5, 'workspace_writable': args.scenario in ('daily', 'independent')}
if options.get('missing_estimate'):
    import agent.model_metadata
    agent.model_metadata.estimate_request_tokens_rough = lambda *args, **kwargs: None
def score_report(report):
    report['local_contract'] = {'observed_scenario': report['scenario'],
        'modified_files': report['fixture_changed'],
        'written': (workspace / 'transport-result.txt').exists()}
run_codex({'args': args, 'run': run, 'workspace': workspace, 'record': record,
    'progress': progress, 'hashes': hashes, 'lease': lease, 'lease_secrets': lease_secrets,
    'safe': safe, 'prompt': f'Read {fixture_path} and finish.',
    'comparison': None, 'usage_self_check': None, 'fixture_before': hashes(workspace),
    'skill_hashes': {}, 'skill_target': run / 'absent-review-skill', 'length_diagnostic': {},
    'runtime': runtime, 'score_report': score_report,
    'summarize_observed_usage': lambda responses, requests, source: {'source': source}})
'''


class _CodexProbe:
    def __init__(self, tmp_path):
        self.codex = shutil.which('codex')
        if not self.codex:
            pytest.skip('Native Codex CLI is required for this free transport probe')
        self.run = tmp_path / 'run'
        self.home = tmp_path / 'home'
        self.home.mkdir()
        self.requests, self.lines = [], []
        self.stages = queue.Queue()
        self.first_request = threading.Event()
        self.release = threading.Event()
        self.process = self.reader = self.http = self.worker = None
        self.old_key, self.new_key = 'local-codex-old-key', 'local-codex-renewed-key'
        self.command = 'cat agent/compaction_display.py'
        self.item_for_request = None

    def serve(self):
        rig = self

        class Model(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                rig.requests.append({'authorization': self.headers.get('Authorization'), 'body': body})
                number = len(rig.requests)
                if number == 1:
                    rig.first_request.set()
                    if not rig.release.wait(timeout=40):
                        return
                if rig.item_for_request is not None:
                    item = rig.item_for_request(body, self.headers.get('X-Aino-Purpose'))
                elif number == 1:
                    item = {'id': 'ct_local', 'type': 'custom_tool_call', 'call_id': 'call_local',
                            'namespace': 'functions', 'name': 'exec', 'status': 'completed',
                            'input': 'text(await tools.exec_command(' + json.dumps({'cmd': rig.command, 'max_output_tokens': 100}) + '));'}
                else:
                    item = {'id': 'msg_local', 'type': 'message', 'role': 'assistant',
                            'phase': 'final_answer', 'status': 'completed',
                            'content': [{'type': 'output_text', 'text': 'LOCAL_LEASE_FINAL', 'annotations': []}]}
                response = {'id': f'resp_{number}', 'object': 'response', 'model': body['model'],
                            'status': 'completed', 'output': [item],
                            'usage': {'input_tokens': 1000, 'output_tokens': 20, 'total_tokens': 1020,
                                      'input_tokens_details': {'cached_tokens': 800, 'cache_write_tokens': 0}}}
                packets = [
                    {'type': 'response.created', 'response': {**response, 'status': 'in_progress', 'output': []}},
                    {'type': 'response.output_item.added', 'output_index': 0, 'item': item},
                    {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                    {'type': 'response.completed', 'response': response},
                ]
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                try:
                    for packet in packets:
                        self.wfile.write(('data: ' + json.dumps(packet) + '\n\n').encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return

        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        self.http.daemon_threads = True
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()
        origin = f'http://127.0.0.1:{self.http.server_port}'
        self.lease = {
            'origin': origin, 'user_id': 'local-codex-user', 'api_key': self.old_key,
            'credential_id': 'local-original', 'base_url': origin + '/v1',
            'model': {'id': 'local-model', 'model': 'gpt-5.6-sol', 'api_mode': 'responses'},
            'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }

    def start(self, *, live=False, **options):
        if live:
            self.serve()
        env = {key: value for key, value in os.environ.items()
               if key in ('PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT')}
        env.update(HOME=str(self.home), USERPROFILE=str(self.home),
                   HERMES_HOME=str(self.home / 'hermes'), PYTHONUNBUFFERED='1',
                   XDG_CONFIG_HOME=str(self.home / '.config'), XDG_CACHE_HOME=str(self.home / '.cache'))
        self.process = subprocess.Popen(
            [sys.executable, '-u', '-c', _BOOTSTRAP, str(self.run), self.codex, 'live' if live else 'dry', json.dumps(options)],
            cwd=_REPO, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True,
        )

        def collect():
            for line in self.process.stdout:
                self.lines.append(line)
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if isinstance(value, dict) and value.get('stage'):
                    self.stages.put(value)
            self.stages.put({'stage': 'process_exited'})

        self.reader = threading.Thread(target=collect, daemon=True)
        self.reader.start()
        if live:
            self.send(self.lease)
        self.wait_stage('session_ready')
        if live:
            assert self.first_request.wait(timeout=15), ''.join(self.lines)

    def send(self, envelope):
        self.process.stdin.write(json.dumps(envelope) + '\n')
        self.process.stdin.flush()

    def wait_stage(self, stage, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = self.stages.get(timeout=max(.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            assert value['stage'] != 'process_exited', ''.join(self.lines)
            if value['stage'] == stage:
                return value
        pytest.fail(f'Codex driver did not emit {stage}:\n' + ''.join(self.lines))

    def finish(self):
        self.wait_stage('finished')
        code = self.process.wait(timeout=10)
        report = json.loads((self.run / 'report.json').read_text())
        assert code == (0 if report['stop_reason'] == 'normal_final' else 2), ''.join(self.lines)
        for secret in (self.old_key, self.new_key):
            assert secret not in ''.join(self.lines)
            assert not [str(p) for p in self.run.rglob('*') if p.is_file() and secret.encode() in p.read_bytes()]
        return report

    def close(self):
        self.release.set()
        if self.process:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=10)
            self.reader.join(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
        if self.http:
            self.http.shutdown()
            self.http.server_close()
            self.worker.join(timeout=5)


@pytest.fixture
def codex_probe(tmp_path):
    probe = _CodexProbe(tmp_path)
    try:
        yield probe
    finally:
        probe.close()


def test_native_codex_keeps_missing_cache_detail_reserved(codex_probe):
    codex_probe.start()
    report = codex_probe.finish()
    assert report['stop_reason'] == 'normal_final'
    accounting = report['input_accounting']
    assert accounting['basis'] == 'input_excluding_cache_reads'
    assert accounting['accounting_complete'] is True
    assert accounting['final_value'] == accounting['approx_represented_input']
    assert accounting['reserved_for_requests_without_usable_usage'] > 0
    assert accounting['settled_requests'] == 0
    assert accounting['peak_value'] >= accounting['final_value']
    assert report['limits']['cumulative_input_basis'] == accounting['basis']


@pytest.mark.parametrize('receipt,expected', [
    ({'exit_code': 0, 'output': 'Quoted "title"\nsecond line\ntest result\n'}, True),
    ({'exit_code': 1, 'output': 'Quoted "title"\nsecond line\n'}, False),
    ({'exit_code': 0, 'output': 'a different file\n'}, False),
    ({'exit_code': 0, 'command': 'Quoted "title"\nsecond line\n'}, False),
])
def test_delegation_probe_requires_a_successful_matching_shell_read(receipt, expected):
    from evals.ultra_delegation.codex_driver import _probe_file_read_returned

    tool_output = {'type': 'custom_tool_call_output', 'call_id': 'local-read', 'output': [
        {'type': 'input_text', 'text': 'Script completed\nOutput:\n'},
        {'type': 'input_text', 'text': json.dumps(receipt)},
    ]}
    assert _probe_file_read_returned(tool_output, 'Quoted "title"\nsecond line\n') is expected


@pytest.mark.parametrize('case', ['passed', 'failed', 'claimed', 'missing-event-id', 'foreign',
                                 'malformed', 'old-test-log', 'missing-session'])
def test_native_child_test_receipts_require_matched_execution_and_deduplicate(tmp_path, case):
    from evals.ultra_delegation.codex_driver import _native_test_tool_calls

    item = {'type': 'CommandExecution', 'id': 'execution-id', 'process_id': 'local-process',
            'command': ['/bin/sh', '-c', 'python -m unittest'],
            'status': 'failed' if case == 'failed' else 'completed',
            'exit_code': 1 if case == 'failed' else 0,
            'aggregated_output': 'Ran 2 tests in 0.001s\n\n' + ('FAILED (failures=1)\n' if case == 'failed' else 'OK\n')}
    if case == 'claimed':
        item['aggregated_output'] = 'I ran unittest and everything passed.'
    if case == 'malformed':
        item['exit_code'] = '0'
    if case == 'old-test-log':
        item['command'] = ['/bin/sh', '-c', 'cat unittest.log']
    if case == 'missing-event-id':
        item.pop('id')
    session = None if case == 'missing-session' else 'other-child' if case == 'foreign' else 'child'
    event = {'type': 'event_msg', 'payload': {'type': 'item_completed', 'thread_id': session,
             'turn_id': 'child-turn', 'item': item}}
    sessions = tmp_path / 'sessions'
    sessions.mkdir()
    for name in ('child.jsonl', 'fork.jsonl'):
        (sessions / name).write_text(json.dumps(event) + '\n')
    rows = _native_test_tool_calls([{'session_id': 'child', 'purpose': 'delegation'}], tmp_path)
    if case in ('passed', 'failed'):
        assert rows == [{'session_id': 'child', 'event_id': 'execution-id', 'turn_id': 'child-turn',
                         'name': 'CommandExecution', 'arguments': item['command'], 'receipts': [item]}]
    else:
        assert rows == []


@pytest.mark.parametrize('case', ['comment-only', 'asynchronous'])
def test_native_child_test_execution_uses_actual_commands_across_async_calls(codex_probe, case):
    rig = codex_probe
    rig.release.set()

    def model_item(body, purpose):
        ident = 'native-probe-' + str(len(rig.requests))
        inputs = body.get('input') or []
        if purpose != 'delegation':
            if 'LOCAL_NATIVE_CHILD_FINAL' in json.dumps(inputs):
                text = 'LOCAL_NATIVE_PARENT_FINAL'
            else:
                spawned = any(item.get('type') == 'function_call_output' for item in inputs)
                return {'id': ident, 'type': 'function_call', 'call_id': ident, 'status': 'completed',
                        'namespace': 'collaboration', 'name': 'wait_agent' if spawned else 'spawn_agent',
                        'arguments': json.dumps({'timeout_ms': 10000} if spawned else {
                            'task_name': 'execution_probe', 'fork_turns': 'all', 'message': 'Run the local test probe.'})}
        else:
            outputs = [item for item in inputs if item.get('type') == 'custom_tool_call_output']
            if not outputs:
                command = 'cat oldlog' if case == 'comment-only' else \
                    'sleep 2 && ' + shlex.quote(sys.executable) + ' -B -m unittest -v test_async_native'
                code = 'text(await tools.exec_command(' + json.dumps({
                    'cmd': command, 'yield_time_ms': 1000, 'max_output_tokens': 500}) + '));'
                if case == 'comment-only':
                    code = '// python -m unittest\n' + code
            else:
                receipts = []
                for block in outputs[-1].get('output') or []:
                    try:
                        value = json.loads(block.get('text', ''))
                    except (TypeError, ValueError):
                        continue
                    if isinstance(value, dict):
                        receipts.append(value)
                pending = next((row for row in receipts if row.get('session_id') is not None), None)
                if pending is None:
                    code = None
                    text = 'LOCAL_NATIVE_CHILD_FINAL'
                else:
                    code = 'text(await tools.write_stdin(' + json.dumps({
                        'session_id': pending['session_id'], 'chars': '', 'yield_time_ms': 1000,
                        'max_output_tokens': 500}) + '));'
            if code is not None:
                return {'id': ident, 'type': 'custom_tool_call', 'call_id': ident, 'status': 'completed',
                        'namespace': 'functions', 'name': 'exec', 'input': code}
        return {'id': ident, 'type': 'message', 'role': 'assistant', 'status': 'completed',
                'phase': 'final_answer', 'content': [{'type': 'output_text', 'text': text, 'annotations': []}]}

    rig.item_for_request = model_item
    rig.start(live=True, scenario='daily', native_counterexample=True)
    report = rig.finish()
    assert report['stop_reason'] == 'normal_final'
    rows = report['native_test_tool_calls']
    if case == 'comment-only':
        assert rows == []
    else:
        assert len(rows) == 1
        assert rows[0]['session_id'] != report['root_session_id']
        assert rows[0]['receipts'][0]['exit_code'] == 0
        assert rows[0]['receipts'][0]['process_id']
        assert ' -m unittest ' in ' '.join(rows[0]['arguments'])
        assert any('tools.write_stdin' in json.dumps(row['body']) for row in rig.requests)


def test_native_codex_renewal_rotates_next_http_request(codex_probe):
    rig = codex_probe
    rig.start(live=True, budget=3600)
    renewed = {**rig.lease, 'api_key': rig.new_key, 'credential_id': 'local-renewed',
               'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()}
    rig.send({'type': 'renew_managed_model', 'lease': renewed})
    receipt = rig.wait_stage('lease_renewed')
    assert receipt['expires_at'] == renewed['expires_at']
    rig.release.set()
    report = rig.finish()
    assert report['stop_reason'] == 'normal_final'
    assert [r['authorization'] for r in rig.requests] == ['Bearer ' + rig.old_key, 'Bearer ' + rig.new_key]
    assert report['final_text'] == 'LOCAL_LEASE_FINAL'
    assert report['input_accounting']['final_value'] == 400
    assert report['input_accounting']['excluded_cache_read_tokens'] == 1600
    assert len({r['system_hash'] for r in report['requests']}) == 1
    assert report['limits']['seconds'] == 3600


@pytest.mark.parametrize('invalid_kind', ['foreign-owner', 'foreign-destination', 'expired', 'missing-key'])
def test_native_codex_invalid_renewal_prevents_the_next_request(codex_probe, invalid_kind):
    rig = codex_probe
    rig.start(live=True)
    renewed = {**rig.lease, 'api_key': rig.new_key}
    if invalid_kind == 'foreign-owner':
        renewed['user_id'] = 'another-user'
    elif invalid_kind == 'foreign-destination':
        renewed['base_url'] = 'https://unreachable.invalid/v1'
    elif invalid_kind == 'expired':
        renewed['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    else:
        renewed.pop('api_key')
    rig.send({'type': 'renew_managed_model', 'lease': renewed})
    rig.wait_stage('lease_renewal_failed')
    rig.release.set()
    report = rig.finish()
    assert report['stop_reason'] == 'lease_renewal_failed'
    assert len(rig.requests) == 1
    assert report['lease_renewals'] == []


@pytest.mark.parametrize('options,reason', [
    ({'input_limit': 1}, 'input_cap'),
    ({'missing_estimate': True}, 'input_accounting_incomplete'),
])
def test_native_codex_reservation_stops_before_another_request(codex_probe, options, reason):
    codex_probe.start(**options)
    report = codex_probe.finish()
    assert report['stop_reason'] == reason
    assert len(report['requests']) == 1
    accounting = report['input_accounting']
    if reason == 'input_cap':
        assert accounting['limit'] == 1
        assert accounting['first_crossing']['phase'] == 'request'
    else:
        assert accounting['first_incomplete']['phase'] == 'request'
        assert accounting['ever_incomplete'] is True


@pytest.mark.parametrize('scenario', ['large', 'daily', 'independent'])
def test_native_codex_task_context_controls_writes_and_scores_final_workspace(codex_probe, scenario):
    rig = codex_probe
    rig.command = 'printf local-evidence > transport-result.txt'
    rig.release.set()
    rig.start(live=True, scenario=scenario)
    report = rig.finish()
    writable = scenario != 'large'
    assert report['scenario'] == scenario
    assert report['sandbox'] == ('workspace-write' if writable else 'read-only')
    assert report['local_contract'] == {
        'observed_scenario': scenario, 'modified_files': ['transport-result.txt'] if writable else [],
        'written': writable,
    }


@pytest.mark.parametrize('scenario', ['daily', 'independent'])
def test_native_codex_writable_dry_exercises_tools_without_repairing_source(codex_probe, scenario):
    codex_probe.start(scenario=scenario)
    report = codex_probe.finish()
    assert report['stop_reason'] == 'normal_final'
    assert report['probes']['real_tool_succeeded'] is True
    assert report['fixture_changed'] == ['test_dry_transport.py']
    commands = [row['item'] for row in report['cli_events']
                if (row.get('item') or {}).get('type') == 'command_execution']
    assert any('unittest' in str(row) and row.get('exit_code') == 0 for row in commands)


@pytest.mark.parametrize('scenario', ['daily', 'independent'])
@pytest.mark.parametrize('dry_case', ['tools', 'delegation'])
def test_harness_scores_native_repair_transport_without_claiming_acceptance(codex_probe, scenario, dry_case):
    from evals.ultra_delegation.convergence import summarize

    completed = subprocess.run(
        [sys.executable, str(_REPO / 'evals/ultra_delegation/harness.py'), scenario,
         '--driver=codex', '--codex-bin=' + codex_probe.codex,
         '--codex-dry-case=' + dry_case,
         '--output-root=' + str(codex_probe.run.parent), '--name=integrated'],
        cwd=_REPO, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60,
    )
    report = json.loads((codex_probe.run.parent / 'integrated/report.json').read_text())
    assert completed.returncode == 0, (completed.stdout, completed.stderr, report['probes'])
    assert report['scenario'] == scenario
    assert report['live'] is False
    assert report['sandbox'] == 'workspace-write'
    repair = report[scenario]
    assert repair['modified_source_files'] == []
    assert repair['new_test_files'] == ['test_dry_transport.py']
    assert repair['model_test_tool_calls']
    assert repair['independent_unittest']['tests_run'] > 0
    assert repair['baseline_contract']['returncode'] != 0
    assert repair['final_contract']['returncode'] != 0
    assert repair['accepted'] is False
    if scenario == 'independent':
        # Keep native CLI coverage behind codex_probe's existing availability gate.
        workspace = codex_probe.run.parent / 'integrated/workspace'
        assert set(report['fixture_hashes']) == {'SPEC.md', 'think_scrubber.py'}
        assert not (workspace / 'manifest.json').exists()
        assert not (workspace / 'independent_contract.py').exists()
        assert not report['review_skill_hashes']
        assert report['limits']['seconds'] == repair['limits']['seconds'] == 600
        assert repair['baseline_contract']['returncode'] == 1
        assert repair['final_contract']['returncode'] == 1
        before = json.loads(repair['baseline_contract']['stdout'])
        after = json.loads(repair['final_contract']['stdout'])
        assert before['failures'] == after['failures'] > 0
        assert repair['independent_unittest']['tests_run'] == 1
    assert report['limits']['requests'] == repair['limits']['requests']
    assert report['limits']['approx_cumulative_input'] == repair['limits']['approx_cumulative_input']
    assert summarize(report)['delivery_evidence']['state'] == 'delivered'
    assert 'completion_guard' not in report
    if dry_case == 'delegation':
        assert report['probes']['child_tool_returned'] is True
        assert report['probes']['delegation_lifecycle_passed'] is True
        assert report['native_test_tool_calls']
        assert all(row['session_id'] != report['root_session_id'] for row in report['native_test_tool_calls'])
        assert all(row in repair['model_test_tool_calls'] for row in report['native_test_tool_calls'])
