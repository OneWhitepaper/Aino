"""The real agent and SDK carry the selected subscription route on every attempt."""

import pytest

from tests.tui_gateway import test_managed_model_agent as existing


@pytest.fixture
def device_gateway(tmp_path, monkeypatch):
    yield from existing.managed_gateway.__wrapped__(tmp_path, monkeypatch)


@pytest.mark.parametrize('protocol', ['chat_completions', 'responses', 'anthropic_messages'])
def test_device_key_reaches_model_with_catalog_identity_and_rebinds_after_rotation(device_gateway, protocol):
    rig = device_gateway
    rig.protocol = protocol
    sid = rig.create()['session_id']
    payload = rig.bind(sid)
    rig.submit(sid, 'Start with the existing lease')
    lease_calls = len(rig.requests)
    assert all('X-Aino-Model-ID' not in headers for headers in rig.request_headers)

    def bind(secret, version):
        selected = {key: payload[key] for key in ('session_id', 'owner', 'model_id')}
        ticket = existing.result(rig.call('session.managed_model_ticket', **selected))
        assert ticket['managed_device_key'] == 1
        claim = existing.result(rig.call('session.claim_managed_model', peer=rig.controller,
                               session_ticket=ticket['session_ticket'], **selected))
        existing.result(rig.call('session.bind_managed_model', peer=rig.controller, **{
            **payload, 'binding_revision': claim['binding_revision'], 'credential_type': 'device',
            'credential_version': version,
            'expires_at': None, 'api_key': secret,
        }))

    bind('device-secret-first', 1)
    rig.submit(sid, 'Read sample.txt')
    assert len(rig.requests) >= 2
    assert all(headers.get('X-Aino-Model-ID') == 'fixture-a' for headers in rig.request_headers[lease_calls:])
    assert all(auth == 'Bearer device-secret-first' for _, auth, _ in rig.requests[lease_calls:])
    bind('device-secret-rotated', 2)
    rig.submit(sid, 'Continue')
    assert rig.requests[-1][1] == 'Bearer device-secret-rotated'
    assert rig.request_headers[-1]['X-Aino-Model-ID'] == 'fixture-a'
