"""Runtime probes honor the same validated profile route as other canonical requests."""
import pytest
import pytest_asyncio

from gateway.run_runtime import initialize_gateway_runtime
from gateway.runtime_ownership import process_ownership
from gateway.session_controls import AuthorityConnection
from tests.gateway.test_session_authorities_multiplex import _reserve_homes, _runner


@pytest_asyncio.fixture
async def probes(tmp_path, monkeypatch):
    root, homes = _reserve_homes(tmp_path, monkeypatch, names=('alpha',))
    process_ownership.reserve([home for _, home in homes])
    runner = _runner(root, homes)
    connections = []
    try:
        await initialize_gateway_runtime(runner)
        primary = runner.session_authorities.for_home(root)
        secondary = runner.session_authorities.for_home(homes[1][1])
        host = AuthorityConnection(primary, object(), {'user_id': 'desktop', 'profile_scope': 'host'})
        bound = AuthorityConnection(secondary, object(), {'user_id': 'desktop'})
        connections.extend([host, bound])
        yield host, bound, {'default': primary, 'alpha': secondary}
    finally:
        for connection in connections:
            await connection.close()
        for authority in list(getattr(runner, 'session_authorities', []) or []):
            authority.db.close()
        for _, home in homes:
            process_ownership.release(home)


async def _probe(connection, method, **params):
    return await connection.dispatch({'id': 1, 'method': method, 'params': params})


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ('runtime.describe', 'ping'))
async def test_host_probe_routes_to_default_and_served_secondary(probes, method):
    host, _bound, authorities = probes
    for profile, authority in authorities.items():
        response = await _probe(host, method, profile=profile)
        assert 'error' not in response, response
        if method == 'runtime.describe':
            assert response['result']['profile_id'] == authority.profile_id
            assert response['result']['instance_id'] == authority.instance_id
            assert 'session-transcript-v1' in response['result']['capabilities']
        else:
            assert response['result'] == {'pong': True}


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ('runtime.describe', 'ping'))
async def test_profile_bound_probe_accepts_its_own_profile_and_refuses_other_profiles(probes, method):
    _host, bound, authorities = probes
    own = await _probe(bound, method, profile='alpha')
    assert 'error' not in own, own
    if method == 'runtime.describe':
        assert own['result']['profile_id'] == authorities['alpha'].profile_id
    for foreign in ('default', 'unserved'):
        refused = await _probe(bound, method, profile=foreign)
        assert refused['error']['message'] == 'profile_mismatch', refused


@pytest.mark.asyncio
async def test_probe_scope_validation_keeps_closed_parameter_sets(probes):
    host, _bound, _authorities = probes
    for method in ('runtime.describe', 'ping'):
        for profile in ('default', 'alpha'):
            refused = await _probe(host, method, profile=profile, unexpected=True)
            assert refused['error']['message'] == 'invalid_params', refused
        for malformed in ('', 1, None):
            refused = await _probe(host, method, profile=malformed)
            assert refused['error']['message'] == 'invalid_params', refused
        refused = await _probe(host, method, profile='unserved', unexpected=True)
        assert refused['error']['message'] == 'profile_mismatch', refused
