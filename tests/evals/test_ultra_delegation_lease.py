"""Live harness stdin leases exercise real RPC, Agent and local Responses HTTP."""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tests.tui_gateway.managed_protocol_fixture import events_for


_REPO = Path(__file__).resolve().parents[2]
_HARNESS = _REPO / 'evals/ultra_delegation/harness.py'
_LOOPBACK_RUNNER = '''
import runpy, socket, sys
def local_only(event, args):
    if event == "socket.getaddrinfo":
        host = args[0]
    elif event == "socket.connect" and args[0].family in (socket.AF_INET, socket.AF_INET6):
        host = args[1][0]
    else:
        return
    if host not in (None, "localhost", "127.0.0.1", "::1"):
        raise OSError("Lease integration test forbids external network access")
sys.addaudithook(local_only)
target = sys.argv.pop(1)
runpy.run_path(target, run_name="__main__")
'''


class _LeaseHarness:
    def __init__(self, tmp_path):
        self.run = tmp_path / 'runs' / 'lease'
        self.home = tmp_path / 'isolated-home'
        self.home.mkdir()
        self.requests = []
        self.agent_requests = []
        self.first_request = threading.Event()
        self.release = threading.Event()
        self.stages = queue.Queue()
        self.lines = []
        self.process = self.reader = None
        self.old_key = 'fixture-old-' + uuid.uuid4().hex
        self.new_key = 'fixture-new-' + uuid.uuid4().hex
        rig = self

        class Model(BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_POST(self):
                if self.path != '/v1/responses':
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                request = {'authorization': self.headers.get('Authorization'), 'body': body}
                rig.requests.append(request)
                if body.get('tools'):
                    rig.agent_requests.append(request)
                    if len(rig.agent_requests) == 1:
                        rig.first_request.set()
                        if not rig.release.wait(timeout=45):
                            return
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                try:
                    for event in events_for(self.path, body, rig.run / 'workspace/agent/compaction_display.py'):
                        self.wfile.write(('event: ' + event['type'] + '\ndata: '
                                          + json.dumps(event) + '\n\n').encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    # Invalid renewal deliberately interrupts the held HTTP stream.
                    return

        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        self.http.daemon_threads = True
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()
        origin = f'http://127.0.0.1:{self.http.server_port}'
        self.lease = {
            'origin': origin, 'user_id': 'local-lease-user',
            'model': {'id': 'fixture-lease-model', 'model': 'gpt-5.6-sol', 'api_mode': 'responses',
                      'capabilities': {'tools': True, 'vision': False, 'reasoning': True}},
            'api_key': self.old_key, 'credential_id': 'fixture-initial', 'base_url': origin + '/v1',
            'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        }

    def start(self):
        env = {key: value for key, value in os.environ.items()
               if key in ('PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT')}
        env.update(HOME=str(self.home), USERPROFILE=str(self.home), PYTHONUNBUFFERED='1',
                   XDG_CONFIG_HOME=str(self.home / '.config'), XDG_DATA_HOME=str(self.home / '.local/share'),
                   XDG_CACHE_HOME=str(self.home / '.cache'))
        self.process = subprocess.Popen(
            [sys.executable, '-u', '-c', _LOOPBACK_RUNNER, str(_HARNESS),
             'large', '--live', '--review-skill=none', '--budget=45',
             f'--repo={_REPO}', f'--fixtures={_REPO / "evals/ultra_delegation/fixtures"}',
             f'--output-root={self.run.parent}', '--name=lease'],
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
        self.send(self.lease)
        self.wait_stage('session_ready', timeout=15)
        assert not self.process.stdin.closed, 'starting the harness must not require stdin EOF'
        assert self.first_request.wait(timeout=15), ''.join(self.lines)

    def send(self, envelope):
        self.process.stdin.write(json.dumps(envelope) + '\n')
        self.process.stdin.flush()

    def wait_stage(self, stage, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                event = self.stages.get(timeout=max(.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            assert event['stage'] != 'process_exited', ''.join(self.lines)
            if event['stage'] == stage:
                return event
        pytest.fail(f'harness did not emit {stage} while stdin stayed open:\n' + ''.join(self.lines))

    def renewed_lease(self):
        return {**self.lease, 'api_key': self.new_key, 'credential_id': 'fixture-renewed',
                'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()}

    def finish(self):
        self.wait_stage('finished', timeout=25)
        returncode = self.process.wait(timeout=10)
        self.reader.join(timeout=5)
        report = json.loads((self.run / 'report.json').read_text())
        assert returncode == (0 if report['stop_reason'] == 'normal_final' else 2), ''.join(self.lines)
        for key in (self.old_key, self.new_key):
            assert key not in ''.join(self.lines)
            leaked = [str(path.relative_to(self.run)) for path in self.run.rglob('*')
                      if path.is_file() and key.encode() in path.read_bytes()]
            assert not leaked, leaked
        return report

    def close(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait(timeout=10)
            self.release.set()
            self.reader.join(timeout=5)
            self.process.stdin.close()
            self.process.stdout.close()
        self.http.shutdown()
        self.http.server_close()
        self.worker.join(timeout=5)


@pytest.fixture
def lease_harness(tmp_path):
    harness = _LeaseHarness(tmp_path)
    try:
        yield harness
    finally:
        harness.close()


def test_live_stdin_renewal_keeps_agent_prefix_and_rotates_next_request(lease_harness):
    rig = lease_harness
    rig.start()
    renewed = rig.renewed_lease()
    rig.send({'type': 'renew_managed_model', 'lease': renewed})
    receipt = rig.wait_stage('lease_renewed')
    assert receipt['expires_at'] == renewed['expires_at']
    rig.release.set()
    report = rig.finish()
    assert report['stop_reason'] == 'normal_final', report.get('error')
    assert len(rig.agent_requests) == 2
    assert rig.agent_requests[0]['authorization'] == 'Bearer ' + rig.old_key
    assert rig.agent_requests[1]['authorization'] == 'Bearer ' + rig.new_key
    assert report['parent_tool_counts'].get('read_file') == 1
    assert len(report['system_hashes_by_session'][report['stored_session_id']]) == 1
    assert report['final_event']['payload']['status'] == 'complete'
    assert report['final_event']['payload']['text']
    assert not rig.process.stdin.closed


@pytest.mark.parametrize('invalid_kind', ['foreign-owner', 'malformed'])
def test_invalid_stdin_renewal_interrupts_without_another_model_request(lease_harness, invalid_kind):
    rig = lease_harness
    rig.start()
    renewed = rig.renewed_lease()
    if invalid_kind == 'foreign-owner':
        renewed['user_id'] = 'another-user'
    else:
        renewed.pop('api_key')
    rig.send({'type': 'renew_managed_model', 'lease': renewed})
    report = rig.finish()
    assert report['stop_reason'] == 'lease_renewal_failed', report.get('error')
    assert report.get('interrupt') is not None
    assert len(rig.agent_requests) == 1
    assert not report.get('final_event')
    assert not any(json.loads(line).get('stage') == 'lease_renewed'
                   for line in rig.lines if line.startswith('{'))
