"""A later explicit picker choice atomically supersedes a pending conversation choice."""
from pathlib import Path

import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call


@pytest.mark.asyncio
@pytest.mark.parametrize('desired, retained', [('older-choice', False), ('newer-choice', True)])
async def test_manual_gui_pick_supersedes_different_selection_but_matching_bind_can_retry(tmp_path, monkeypatch, desired, retained):
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    home = tmp_path / 'state'
    home.mkdir()
    (home / 'config.yaml').write_text('model:\n  provider: custom\n  default: original\n'
                                     '  base_url: http://127.0.0.1:1/v1\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    authority = await initialize_session_authority(GatewayRunner(), profile_id=str(home), instance_id='selection')
    viewer = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    try:
        created = await call(viewer, 'session.create', request_id='gui', source='gui', cwd=str(tmp_path),
                             toolsets=[], model_source='aino', model_id='original')
        assert 'result' in created, created
        sid = created['result']['session_id']
        authority.db.patch_session_model_config(sid, {'conversation_model_selection': {
            'scope': {'owner_subject': viewer.actor.subject},
            'selection': {'model_id': desired, 'model_source': 'aino', 'provider': 'aino',
                          'owner': {'platform_origin': 'https://models.example.test', 'user_id': 'one'}}}})
        before = authority.db.get_session(sid)
        selected = await call(viewer, 'session.mutate', session_id=sid, request_id='newer-explicit-pick',
                              operation='model', expected_revision=before['runtime_revision'],
                              expected_generation=before['runtime_generation'],
                              payload={'model': 'newer-choice', 'model_source': 'aino'})
        assert 'result' in selected, selected
        assert authority.db.get_session(sid)['model'] == 'newer-choice'
        saved = authority.db.get_session_model_config_value(sid, 'conversation_model_selection')
        assert (saved is not None) is retained
    finally:
        await viewer.close()
        authority.db.close()
