"""The canonical desktop transport reuses profile-local consent, without sending counts on save."""
import sqlite3
from dataclasses import replace

import hermes_yaml as yaml
import pytest

from tests.gateway.test_session_diagnostics import connection


@pytest.mark.asyncio
async def test_canonical_consent_requires_a_new_aino_answer_and_stays_in_the_owning_profile(tmp_path, monkeypatch):
    import socket

    launch, worker = tmp_path / 'launch', tmp_path / 'worker'
    for home in (launch, worker):
        home.mkdir()
        (home / 'config.yaml').write_text(yaml.safe_dump({'telemetry': {'shared_metrics': {
            'enabled': True, 'send': True, 'offer_version': 2}}}))
    before = (launch / 'config.yaml').read_bytes()
    monkeypatch.setenv('HERMES_HOME', str(launch))

    def no_network(*args, **kwargs):
        pytest.fail('answering consent must not upload anything')

    monkeypatch.setattr(socket.socket, 'connect', no_network)
    peer = connection(worker)
    peer.actor = replace(peer.actor, capabilities=frozenset({'session:read', 'session:operator'}))
    status = await peer.dispatch({'id': 1, 'method': 'shared_metrics.status', 'params': {}})
    assert status.get('result') == {
        'enabled': True, 'send': False, 'decided': False, 'reask': True, 'recipient': 'aino'}, status
    params = {'enabled': True, 'send': True}
    refused = await peer.dispatch({'id': 2, 'method': 'shared_metrics.set', 'params': params})
    assert refused.get('error', {}).get('message') == 'invalid_params', refused
    accepted = await peer.dispatch({'id': 3, 'method': 'shared_metrics.set',
                                    'params': {**params, 'recipient': 'aino'}})
    assert accepted.get('result') == {
        'enabled': True, 'send': True, 'decided': True, 'reask': False, 'recipient': 'aino'}, accepted
    cfg = yaml.safe_load((worker / 'config.yaml').read_text())['telemetry']['shared_metrics']
    assert cfg['endpoint'] == 'https://api.agentera.com.cn/api/v1/desktop/shared-metrics'
    assert cfg['recipient'] == 'aino'
    opted_out = await peer.dispatch({'id': 4, 'method': 'shared_metrics.set',
                                    'params': {'enabled': False, 'send': False}})
    assert opted_out.get('result', {}).get('send') is False, opted_out
    with sqlite3.connect(worker / 'telemetry' / 'shared_metrics' / 'metrics.sqlite3') as db:
        rows = db.execute('SELECT recipient,closed_at FROM send_consent_windows').fetchall()
    assert len(rows) == 1 and rows[0][0] == 'aino' and rows[0][1] is not None
    assert (launch / 'config.yaml').read_bytes() == before
    assert not (launch / 'telemetry').exists()


@pytest.mark.asyncio
async def test_canonical_consent_readers_cannot_grant_sharing_or_select_a_foreign_profile(tmp_path):
    peer = connection(tmp_path, operator=False)
    denied = await peer.dispatch({'id': 1, 'method': 'shared_metrics.set',
                                 'params': {'enabled': True, 'send': True, 'recipient': 'aino'}})
    assert denied.get('error', {}).get('message') == 'permission_denied', denied
    foreign = await peer.dispatch({'id': 2, 'method': 'shared_metrics.status', 'params': {'profile': 'foreign'}})
    assert foreign.get('error', {}).get('message') == 'profile_mismatch', foreign
    assert not (tmp_path / 'config.yaml').exists()
