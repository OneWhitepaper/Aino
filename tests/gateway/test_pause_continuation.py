"""A user continuation appends to interrupted history without replaying the stopped input."""
import asyncio
import json

import pytest

from gateway.session_controls import AuthorityConnection
from hermes_state_runtime import claim_session_input, settle_session_input
from tests.gateway.test_surface_admission import _authority


async def _paused(tmp_path, monkeypatch, outcome='interrupted'):
    authority = await _authority(tmp_path, monkeypatch, lambda event: None)
    monkeypatch.setattr(authority, '_schedule', lambda ref: None)
    connection = AuthorityConnection(authority, object(), {'user_id': 'owner'})
    await connection.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 's'}})
    submitted = await connection.dispatch({'id': 2, 'method': 'prompt.submit', 'params': {
        'session_id': 's', 'submission_id': 'original', 'text': 'Perform the task once'}})
    row = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
    assert row['admission_id'] == submitted['result']['admission_id']
    authority.db.append_message('s', 'user', 'Perform the task once')
    authority.db.append_message('s', 'assistant', None, tool_calls=[{'id': 'done', 'type': 'function',
        'function': {'name': 'terminal', 'arguments': '{"command":"touch result"}'}}])
    authority.db.append_message('s', 'tool', 'operation completed', tool_call_id='done')
    settle_session_input(authority.db, epoch=authority.epoch, admission_id=row['admission_id'],
                         generation=row['generation'], outcome=outcome)
    paused = {'admission_id': row['admission_id'], 'execution_generation': row['generation'],
              'revision': authority.db.get_session('s')['runtime_revision']}
    return authority, connection, paused


def _submit(params, rid=3):
    return {'id': rid, 'method': 'prompt.submit', 'params': {
        'session_id': 's', 'submission_id': 'continue-once', 'text': 'Continue from the preserved progress.',
        'display_kind': 'hidden', 'continuation_of': params}}


@pytest.mark.asyncio
async def test_continuation_keeps_tool_evidence_and_admits_only_once(tmp_path, monkeypatch):
    authority, connection, paused = await _paused(tmp_path, monkeypatch)
    before = authority.db.get_messages('s')
    try:
        first = await connection.dispatch(_submit(paused))
        assert first.get('result', {}).get('status') == 'queued', first
        again = await connection.dispatch(_submit(paused, 4))
        assert again['result']['admission_id'] == first['result']['admission_id']
        assert authority.db.get_messages('s') == before
        with authority.db._read_ctx() as conn:
            rows = conn.execute('SELECT payload_json FROM session_admissions ORDER BY seq').fetchall()
        assert len(rows) == 2
        assert json.loads(rows[-1][0])['display_v1']['kind'] == 'hidden'
    finally:
        await connection.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('changed', ['queued', 'revision', 'generation', 'wrong_admission', 'stopping', 'completed', 'failed', 'unknown'])
async def test_continuation_refuses_changed_task_or_unsettled_stop(tmp_path, monkeypatch, changed):
    authority, connection, paused = await _paused(tmp_path, monkeypatch,
                                               outcome=changed if changed in {'completed', 'failed'} else 'interrupted')
    mutations = {
        'revision': ('UPDATE sessions SET runtime_revision=runtime_revision+1 WHERE id=?', ('s',)),
        'generation': ('UPDATE sessions SET runtime_generation=runtime_generation+1 WHERE id=?', ('s',)),
        'stopping': ("UPDATE session_admissions SET status='started',outcome=NULL WHERE admission_id=?", (paused['admission_id'],)),
        'unknown': ("UPDATE session_admissions SET status='unknown',outcome=NULL WHERE admission_id=?", (paused['admission_id'],)),
    }
    try:
        if changed == 'queued':
            await connection.dispatch({'id': 5, 'method': 'prompt.submit', 'params': {
                'session_id': 's', 'submission_id': 'other', 'text': 'Different task'}})
        elif changed == 'wrong_admission':
            paused['admission_id'] = 'foreign'
        elif changed in mutations:
            authority.db._execute_write(lambda conn: conn.execute(*mutations[changed]))
        refused = await connection.dispatch(_submit(paused))
        assert refused.get('error', {}).get('message') == 'stale_continuation', refused
    finally:
        await connection.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('changed', ['actor', 'session', 'profile', 'bool_generation', 'bool_revision',
                                   'negative_generation', 'negative_revision'])
async def test_continuation_identity_and_shape_are_not_coerced(tmp_path, monkeypatch, changed):
    authority, connection, paused = await _paused(tmp_path, monkeypatch)
    try:
        request = _submit(paused)
        if changed == 'actor':
            authority.db._execute_write(lambda conn: conn.execute(
                'UPDATE session_admissions SET principal_id=? WHERE admission_id=?', ('other-owner', paused['admission_id'])))
        elif changed == 'session':
            authority.db.create_session('another-session', source='telegram')
            authority.db._execute_write(lambda conn: conn.execute(
                'UPDATE session_admissions SET target_session_id=? WHERE admission_id=?', ('another-session', paused['admission_id'])))
        elif changed == 'profile':
            request['params']['profile'] = 'foreign-profile'
        else:
            field = 'execution_generation' if changed.endswith('generation') else 'revision'
            paused[field] = True if changed.startswith('bool') else -1
        refused = await connection.dispatch(request)
        assert 'result' not in refused, refused
        if changed in {'actor', 'session'}:
            assert refused['error']['message'] == 'stale_continuation'
        elif changed != 'profile':
            assert refused['error']['message'] == 'invalid_params'
        with authority.db._read_ctx() as conn:
            assert conn.execute('SELECT COUNT(*) FROM session_admissions').fetchone()[0] == 1
    finally:
        await connection.close()


@pytest.mark.asyncio
async def test_competing_continuations_admit_one_and_exact_retry_stays_idempotent_after_claim(tmp_path, monkeypatch):
    authority, connection, paused = await _paused(tmp_path, monkeypatch)
    try:
        other = _submit(paused, 4)
        other['params']['submission_id'] = 'competing-continuation'
        results = await asyncio.gather(connection.dispatch(_submit(paused)), connection.dispatch(other))
        accepted = [reply for reply in results if 'result' in reply]
        refused = [reply for reply in results if 'error' in reply]
        assert len(accepted) == len(refused) == 1, results
        assert refused[0]['error']['message'] == 'stale_continuation'
        claimed = claim_session_input(authority.db, epoch=authority.epoch, session_id='s')
        retry = _submit(paused, 5) if 'result' in results[0] else other
        repeated = await connection.dispatch(retry)
        assert repeated['result']['admission_id'] == claimed['admission_id']
        assert repeated['result']['status'] == 'started'
    finally:
        await connection.close()
