"""Desktop diagnostics collect locally; only the native account client uploads."""
import base64
import gzip
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from gateway.session_contract import Principal
from gateway.session_controls import AuthorityConnection
from hermes_constants import get_hermes_home


def connection(home, operator=True):
    peer = AuthorityConnection.__new__(AuthorityConnection)
    peer.authority = SimpleNamespace(profile_id=str(home), sessions={},
                                     runner=SimpleNamespace(config=SimpleNamespace(multiplex_profiles=True)))
    peer.actor = Principal('test-viewer', str(home), frozenset({'session:operator'} if operator else {'session:read'}), 'test')
    peer._identity, peer._operator, peer._siblings = {}, operator, {}
    return peer


@pytest.mark.asyncio
async def test_canonical_collector_is_operator_only_and_profile_scoped(tmp_path, monkeypatch):
    from hermes_cli import debug
    import hermes_cli.diagnostics_upload as upload
    homes = []

    def collect(**kwargs):
        assert kwargs['redact'] is True
        homes.append(get_hermes_home())
        return {'report': 'synthetic diagnostic'}

    monkeypatch.setattr(debug, 'collect_share_bundle', collect)
    monkeypatch.setattr(upload, 'share_to_nous', lambda *_: pytest.fail('collector attempted third-party upload'))
    secret = 'sk-abc123def456ghi789jkl012mno345pqr678'
    request = {'id': 1, 'method': 'diagnostics.collect', 'params': {
        'error_context': f'key={secret}', 'extra_files': {'../desktop.log': f'key={secret}'}}}
    home = tmp_path / 'secondary'
    home.mkdir()
    denied = await connection(home, operator=False).dispatch(request)
    assert denied.get('error', {}).get('message') == 'permission_denied', denied
    assert not homes
    reply = await connection(home).dispatch(request)
    result = reply.get('result', {})
    assert result.get('ok') is True, reply
    assert homes == [home]
    envelope = json.loads(gzip.decompress(base64.b64decode(result['bundle_base64'])))
    assert envelope['redacted'] is True
    assert envelope['files']['report'] == 'synthetic diagnostic'
    assert secret not in json.dumps(envelope)
    assert 'client/desktop.log' in envelope['files']


@pytest.mark.asyncio
async def test_collector_refuses_cross_profile_and_unsupported_input(tmp_path, monkeypatch):
    from hermes_cli import debug
    monkeypatch.setattr(debug, 'collect_share_bundle', lambda **_: pytest.fail('refused input collected logs'))
    peer = connection(tmp_path)
    for params, reason in [({'profile': 'foreign'}, 'profile_mismatch'),
                           ({'redact': False}, 'invalid_params')]:
        reply = await peer.dispatch({'id': 2, 'method': 'diagnostics.collect', 'params': params})
        assert reply.get('error', {}).get('message') == reason, reply


@pytest.mark.asyncio
@pytest.mark.parametrize('transport', ['canonical', 'standalone'])
async def test_real_collector_reads_the_owning_profile_without_upload(tmp_path, monkeypatch, transport):
    import socket

    from tui_gateway import server
    launch = tmp_path / 'launch'
    worker = tmp_path / 'worker'
    for home, marker in ((launch, 'launch-only-log'), (worker, 'worker-only-log')):
        (home / 'logs').mkdir(parents=True)
        (home / 'logs' / 'agent.log').write_text(
            f'2026-10-24 00:00:00 INFO synthetic: {marker} api_key=sk-synthetic-secret-123456789\n',
            encoding='utf-8')
    monkeypatch.setenv('HERMES_HOME', str(launch))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    monkeypatch.setattr(server, '_hermes_home', launch)
    monkeypatch.setattr(server, '_profile_home', lambda name: worker if name == 'worker' else None)

    def no_network(*args, **kwargs):
        pytest.fail('collect-only diagnostics attempted network I/O')

    monkeypatch.setattr(socket.socket, 'connect', no_network)
    monkeypatch.setattr(socket.socket, 'connect_ex', no_network)
    monkeypatch.setattr(socket, 'create_connection', no_network)
    if transport == 'canonical':
        reply = await connection(worker).dispatch({'id': 3, 'method': 'diagnostics.collect', 'params': {}})
    else:
        reply = server._methods['diagnostics.collect'](3, {'profile': 'worker'})
    result = reply.get('result', {})
    assert result.get('ok') is True, reply
    envelope = json.loads(gzip.decompress(base64.b64decode(result['bundle_base64'])))
    log = envelope['files']['agent.log']
    assert 'worker-only-log' in log
    assert 'launch-only-log' not in log
    assert 'sk-synthetic-secret-123456789' not in json.dumps(envelope)
    assert get_hermes_home() == launch
