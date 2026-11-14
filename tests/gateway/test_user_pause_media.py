"""Paused original attachments survive existing media cleanup until their continuation settles."""
import os
from pathlib import Path
import time

import pytest

from gateway.session_controls import AuthorityConnection
from gateway.session_ingress_media import release_admission_media, sweep_settled_media
from gateway.session_managed_worker import _interrupted_before_bootstrap
from gateway.session_pause import continuation_descriptor, continuation_history, continuation_turn_scope
from gateway.session_results import finish_result
from hermes_state_runtime import claim_session_input
from tests.agent.test_preflight_compression_cap_e2e import _make_agent, _stop_response
from tests.gateway.test_api_media_retention import PNG
from tests.gateway.test_surface_admission import _authority
from tests.gateway.test_user_pause_persistence import _submit


@pytest.mark.asyncio
async def test_unstarted_pause_keeps_attachment_through_continue_and_age_sweep(tmp_path, monkeypatch):
    from gateway.platforms.base import get_image_cache_dir

    authority = await _authority(tmp_path, monkeypatch, lambda event: None)
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    connection = AuthorityConnection(authority, object(), {'user_id': 'owner'})
    staging = get_image_cache_dir()
    staging.mkdir(parents=True, exist_ok=True)
    image = staging / 'input.png'
    image.write_bytes(PNG)
    try:
        await connection.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 's'}})
        await _submit(connection, 2, 'Inspect the original picture', attachments=[{'path': str(image), 'mime': 'image/png'}])
        row = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        retained = Path(row['payload']['attachments_v1']['media'][0]['path'])
        image.unlink()
        _interrupted_before_bootstrap(authority, row)
        finish_result(authority.db, epoch=authority.epoch, row=row, response='', outcome='interrupted',
                      result=authority.pending_results[row['admission_id']])
        release_admission_media(authority.db, row['admission_id'])
        os.utime(retained, (time.time() - 49 * 3600,) * 2)
        sweep_settled_media(authority.db, now=time.time() + 2 * 3600)
        assert retained.read_bytes() == PNG
        session = authority.db.get_session('s')
        await _submit(connection, 3, 'Continue.', display_kind='hidden', continuation_of={
            'admission_id': row['admission_id'], 'execution_generation': row['generation'],
            'revision': session['runtime_revision']})
        continued = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        release_admission_media(authority.db, row['admission_id'])
        assert retained.exists()
        with continuation_turn_scope(continuation_descriptor(authority.db, continued)):
            history = continuation_history([])
        assert any(part.get('type') == 'image_url' for part in history[0]['content'])
        agent = _make_agent(monkeypatch, tmp_path, max_attempts=3)
        agent._session_db, agent.session_id = authority.db, 's'
        agent.compression_enabled = False
        agent.client.chat.completions.create.return_value = _stop_response()
        result = agent.run_conversation('Continue.', conversation_history=history, persist_user_display_kind='hidden')
        assert result['completed']
        finish_result(authority.db, epoch=authority.epoch, row=continued, response='done', outcome='completed',
                      result={'result': result, 'usage': {}})
        sweep_settled_media(authority.db, now=time.time() + 4 * 3600)
        assert not retained.exists(), 'a completed continuation must release the extra pause hold'
    finally:
        await connection.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [
    {'interrupted': True, 'api_calls': 0, 'final_response': ''},
    {'interrupted': True, 'api_calls': 1, 'partial': True, 'final_response': 'Visible preserved draft.'},
])
async def test_completed_work_or_zero_calls_without_preloop_proof_never_replays_original(tmp_path, monkeypatch, result):
    authority = await _authority(tmp_path, monkeypatch, lambda event: None)
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    connection = AuthorityConnection(authority, object(), {'user_id': 'owner'})
    try:
        await connection.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 's'}})
        await _submit(connection, 2, 'Original task')
        row = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        authority.db.append_message('s', 'user', 'Original task')
        authority.db.append_message('s', 'assistant', 'Visible preserved draft.')
        finish_result(authority.db, epoch=authority.epoch, row=row, response=result['final_response'],
                      outcome='interrupted', result={'result': result, 'usage': {}})
        session = authority.db.get_session('s')
        await _submit(connection, 3, 'Continue.', display_kind='hidden', continuation_of={
            'admission_id': row['admission_id'], 'execution_generation': row['generation'],
            'revision': session['runtime_revision']})
        continued = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        assert continuation_descriptor(authority.db, continued) is None
        history = authority.db.get_messages_as_conversation('s')
        with continuation_turn_scope(None):
            assert continuation_history(history) is history
        assert [m['content'] for m in history] == ['Original task', 'Visible preserved draft.']
    finally:
        await connection.close()


@pytest.mark.asyncio
async def test_original_reference_refusal_stops_continuation_before_handler(tmp_path, monkeypatch):
    from gateway.session_contract import SessionRef
    from gateway.session_ingress import execute_admission

    async def unexpected(event):
        pytest.fail('a refused original reference must not reach the model handler')

    authority = await _authority(tmp_path, monkeypatch, unexpected)
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    connection = AuthorityConnection(authority, object(), {'user_id': 'owner'})
    seen = []

    async def refuse(runner, source, route, text):
        seen.append(text)
        return None, 'Original reference refused by existing safety checks.'

    monkeypatch.setattr('gateway.session_context_refs.inbound_references', refuse)
    try:
        await connection.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 's'}})
        await _submit(connection, 2, 'Use @file:original.txt')
        row = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        _interrupted_before_bootstrap(authority, row)
        finish_result(authority.db, epoch=authority.epoch, row=row, response='', outcome='interrupted',
                      result=authority.pending_results[row['admission_id']])
        session = authority.db.get_session('s')
        await _submit(connection, 3, 'Continue.', display_kind='hidden', continuation_of={
            'admission_id': row['admission_id'], 'execution_generation': row['generation'],
            'revision': session['runtime_revision']})
        continued = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        reply = await execute_admission(authority, SessionRef(authority.profile_id, 's'), continued)
        assert seen == ['Use @file:original.txt']
        assert reply == 'Original reference refused by existing safety checks.'
        assert authority.db.get_messages('s') == []
    finally:
        await connection.close()
