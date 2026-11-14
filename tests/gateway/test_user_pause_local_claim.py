"""A verified Continue retains local viewer provenance through the real LOCAL claim boundary."""
from types import SimpleNamespace

import pytest

from gateway.session_contract import SessionActor, Submission
from gateway.session_operator import check_local_input, is_viewer_input
from gateway.session_results import finish_result
from hermes_state_runtime import RuntimeStoreError


@pytest.mark.asyncio
async def test_local_continue_is_claimed_as_viewer_input_without_weakening_owner_checks(tmp_path, monkeypatch):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from gateway.session_local import create_local_session
    from gateway.owner_identity import host_owner_subject

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setattr(run, '_load_gateway_config', lambda: {'platform_toolsets': {'cli': []}})
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _cached_agent_for=lambda route: None, _adapter_for_source=lambda source: None)
    authority = await initialize_session_authority(runner, profile_id=str(tmp_path), instance_id='fixture')
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    subject = host_owner_subject()
    owner = SessionActor(subject, str(tmp_path), frozenset({'session:create', 'session:submit', 'session:read'}), 'owner')
    ref = create_local_session(authority, owner, {'request_id': 'local', 'source': 'gui',
        'cwd': str(tmp_path), 'model': 'fixture', 'toolsets': []})
    try:
        sent = await authority.submit(owner, Submission('original', ref, {'text': 'Original task'}, 'queue'))
        assert sent.status == 'queued'
        live = authority.sessions[ref.session_id]
        row, _ = await authority._claim_next(ref, live)
        finish_result(authority.db, epoch=authority.epoch, row=row, response='', outcome='interrupted',
            result={'result': {'interrupted': True, 'completed': False, 'final_response': '', 'api_calls': 1}, 'usage': {}})
        session = authority.db.get_session(ref.session_id)
        queued = await authority.submit(owner, Submission('continue', ref, {
            'text': 'Continue from preserved progress.', 'display_kind': 'hidden',
            'continuation_of': {'admission_id': row['admission_id'],
                'execution_generation': row['generation'], 'revision': session['runtime_revision']}}, 'queue'))
        assert queued.status == 'queued'
        continued, _ = await authority._claim_next(ref, live)
        assert continued['admission_id'] == queued.admission_id
        assert continued['generation'] == row['generation'] + 1
        assert is_viewer_input(continued)
        with pytest.raises(RuntimeStoreError, match='permission_denied'):
            check_local_input(authority, ref, {**continued, 'principal_id': 'other-account'})
        with pytest.raises(RuntimeStoreError, match='permission_denied'):
            check_local_input(authority, ref, {**continued, 'payload': {**continued['payload'], 'unknown_v1': {}}})
    finally:
        store._db.close()
