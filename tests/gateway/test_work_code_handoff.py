"""Reviewed Work/Code handoffs create independent, durably related local conversations."""

from persistence.conversation.messages import NewMessage
from persistence.conversation.lineage import CompressionChild
from persistence.conversation.sessions import SessionQuery, SessionWindow
from dataclasses import asdict
from tests.fixtures.storage_holder import raw_holder
from tests.fixtures.storage_read import session_row
from tests.fixtures.storage_read import transcript_rows
import asyncio

import pytest

from tests.gateway.fixtures.storage_handles import close_storage_handles
from tests.gateway.test_session_create_tier_cwd import _owner

pytestmark = pytest.mark.usefixtures("authority_cwd_in_tmp")


async def _create(connection, cwd, key, **extra):
    return await connection.dispatch({'id': key, 'method': 'session.create', 'params': {
        'request_id': key, 'source': 'gui', 'cwd': str(cwd), 'cwd_explicit': True,
        'model': 'fixture-model', 'toolsets': [], **extra}})


def _context(sid, **extra):
    return {'source_session_id': sid, 'summary': 'Implement the reviewed requirements',
            'files': ['src/main.ts'], **extra}


@pytest.mark.asyncio
async def test_reviewed_handoff_is_atomic_idempotent_and_does_not_run_or_copy_parent(tmp_path, monkeypatch):


    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        authority.persistence.messages.append(source, NewMessage(role='user', content='Private source transcript'))
        before = transcript_rows(authority.persistence, source)
        params = dict(execution_mode='code', handoff=_context(source))
        results = await asyncio.gather(*(_create(connection, tmp_path, 'handoff', **params) for _ in range(2)))
        assert all('result' in result for result in results), results
        child = results[0]['result']
        sid = child['session_id']
        assert results[1]['result']['session_id'] == sid
        assert session_row(authority.persistence, sid)['parent_session_id'] == source
        assert child['info']['handoff'] == _context(source)
        assert child['info']['execution_mode'] == 'code'
        assert child['messages'] == []
        assert child['info']['linked_sessions'] == [{
            'session_id': source, 'title': '', 'execution_mode': 'work', 'relation': 'source'}]
        assert transcript_rows(authority.persistence, source) == before
        assert transcript_rows(authority.persistence, sid) == []
        assert [asdict(row) for row in authority.persistence.admissions.list(session_id=sid)] == []
        assert asdict(authority.persistence.bindings.receipt(sid))['policy']['execution_mode'] == 'code'
        assert sid in {row.session.session_id for row in authority.persistence.sessions.list_sessions(SessionQuery(), SessionWindow(limit=200))}
        changed = await _create(connection, tmp_path, 'handoff', **{
            **params, 'handoff': _context(source, summary='Changed requirements')})
        assert changed['error']['data']['reason'] == 'invalid_params'
        parent = await connection.dispatch({'id': 'info', 'method': 'session.info', 'params': {'session_id': source}})
        assert parent['result']['linked_sessions'][0]['session_id'] == sid
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_handoff_relationship_and_reviewed_draft_survive_cold_owner(tmp_path, monkeypatch):
    home = tmp_path / 'home'
    config = {'model': {'default': 'fixture-model', 'api_mode': 'responses'}}
    store, _runner, _authority, connection = _owner(home, monkeypatch, config)
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        response = await _create(connection, tmp_path, 'code', execution_mode='code', handoff=_context(source))
        assert 'result' in response, response
        child = response['result']['session_id']
    finally:
        await connection.close()
        store.close_all_db_handles()
    store, _runner, _authority, connection = _owner(home, monkeypatch, config)
    try:
        for sid, linked in [(source, child), (child, source)]:
            result = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': sid}})
            assert 'result' in result, result
            assert result['result']['info']['linked_sessions'][0]['session_id'] == linked
        assert result['result']['info']['handoff'] == _context(source)
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_handoff_child_survives_deleted_source_as_an_independent_conversation(tmp_path, monkeypatch):
    store, _runner, _authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        response = await _create(connection, tmp_path, 'code', execution_mode='code', handoff=_context(source))
        child = response['result']['session_id']
        deleted = await connection.dispatch({'id': 'delete', 'method': 'session.mutate', 'params': {
            'session_id': source, 'request_id': 'delete-source', 'expected_revision': 0,
            'expected_generation': 0, 'operation': 'delete', 'payload': {}}})
        assert 'result' in deleted, deleted
        resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': child}})
        assert 'result' in resumed, resumed
        assert resumed['result']['info']['handoff'] == _context(source)
        assert resumed['result']['info']['linked_sessions'] == []
        retried = await _create(connection, tmp_path, 'code', execution_mode='code', handoff=_context(source))
        assert 'result' in retried, retried
        assert retried['result']['session_id'] == child
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
@pytest.mark.parametrize('handoff', [False, True])
async def test_denied_create_retry_does_not_modify_existing_sidebar_state(tmp_path, monkeypatch, handoff):
    from gateway.session_controls import AuthorityConnection

    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    restricted = None
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        params = {'hidden': True, **({'execution_mode': 'code', 'handoff': _context(source)} if handoff else {})}
        child = (await _create(connection, tmp_path, 'child', **params))['result']
        sid = child['session_id']
        shown = await connection.dispatch({'id': 'show', 'method': 'session.mutate', 'params': {
            'session_id': sid, 'request_id': 'show-child', 'operation': 'sidebar', 'payload': {'hidden': False},
            'expected_revision': child['revision'], 'expected_generation': child['execution_generation']}})
        assert 'result' in shown, shown
        restricted = AuthorityConnection(authority, object(), {
            'user_id': 'human', 'capabilities': ['session:create']})
        denied = await _create(restricted, tmp_path, 'child', **params)
        assert denied['error']['data']['reason'] == 'permission_denied'
        assert not session_row(authority.persistence, sid)['hidden']
    finally:
        if restricted is not None:
            await restricted.close()
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_handoff_refuses_foreign_source_same_mode_and_missing_source(tmp_path, monkeypatch):
    from gateway.session_controls import AuthorityConnection

    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    foreign = AuthorityConnection(authority, object(), {'user_id': 'another-human'})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        cases = [(foreign, 'foreign', 'code', source, 'permission_denied'),
                 (connection, 'same-mode', 'work', source, 'invalid_params'),
                 (connection, 'missing', 'code', 'missing-source', 'not_found')]
        for caller, key, mode, source_id, reason in cases:
            result = await _create(caller, tmp_path, key, execution_mode=mode, handoff=_context(source_id))
            assert result['error']['data']['reason'] == reason, result
        with raw_holder(authority.persistence)._read_ctx() as conn:
            assert conn.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 1
    finally:
        await foreign.close()
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_ordinary_branch_does_not_invent_another_cross_mode_handoff(tmp_path, monkeypatch):
    store, _runner, _authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        child = (await _create(connection, tmp_path, 'code', execution_mode='code', handoff=_context(source)))['result']
        branch = await connection.dispatch({'id': 'branch', 'method': 'session.mutate', 'params': {
            'session_id': child['session_id'], 'request_id': 'branch', 'expected_revision': child['revision'],
            'expected_generation': 0, 'operation': 'branch', 'payload': {}}})
        assert 'result' in branch, branch
        info = await connection.dispatch({'id': 'info', 'method': 'session.info',
                                          'params': {'session_id': child['session_id']}})
        assert all(link['relation'] != 'child' for link in info['result']['linked_sessions'])
        branch_info = await connection.dispatch({'id': 'info', 'method': 'session.info',
            'params': {'session_id': branch['result']['branched_session_id']}})
        assert not branch_info['result'].get('handoff')
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_source_deleted_after_staging_refuses_entire_handoff_commit(tmp_path, monkeypatch):
    from gateway.session_authorities import owner_scope
    from gateway.session_local import stage_local_session
    from gateway.session_local import commit_local_session
    from persistence import AuthorityRefusal

    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        with owner_scope(authority):
            staged = stage_local_session(authority, connection.actor, {
                'request_id': 'staged', 'source': 'gui', 'cwd': str(tmp_path), 'cwd_explicit': True,
                'model': 'fixture-model', 'toolsets': [], 'execution_mode': 'code', 'handoff': _context(source)})
        authority.persistence.sessions.delete(source, media_root=str(tmp_path / "media"))
        with pytest.raises(AuthorityRefusal) as refused:
            commit_local_session(authority.persistence, epoch=authority.epoch, receipt=staged)
        assert refused.value.reason == 'not_found'
        assert session_row(authority.persistence, staged['session_id']) is None
        with raw_holder(authority.persistence)._read_ctx() as conn:
            assert conn.execute('SELECT 1 FROM gateway_routing WHERE session_key=?', (staged['route'],)).fetchone() is None
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
@pytest.mark.parametrize('bad_context', [
    {'summary': '  '}, {'summary': 'x' * 32001}, {'files': ['bad\npath']},
    {'files': ['x'] * 33}, {'files': [123]}, {'unexpected': 'not admitted'},
])
async def test_invalid_review_context_never_creates_a_child(tmp_path, monkeypatch, bad_context):
    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        result = await _create(connection, tmp_path, 'bad', execution_mode='code', handoff=_context(source, **bad_context))
        assert result['error']['data']['reason'] == 'invalid_params'
        with raw_holder(authority.persistence)._read_ctx() as conn:
            assert conn.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 1
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_handoff_title_conflict_rolls_back_the_child_and_valid_title_retries(tmp_path, monkeypatch):
    from persistence.authority.bindings import local_session_id
    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work', title='Existing title'))['result']['session_id']
        params = dict(execution_mode='code', title='Existing title', handoff=_context(source))
        response = await _create(connection, tmp_path, 'code', **params)
        sid = local_session_id(authority.profile_id, connection.actor.subject, 'code')
        assert response['error']['data']['reason'] == 'admission_conflict'
        assert session_row(authority.persistence, sid) is None
        params['title'] = 'Reviewed implementation'
        response = await _create(connection, tmp_path, 'code', **params)
        assert 'result' in response, response
        assert response['result']['info']['title'] == 'Reviewed implementation'
        retry = await _create(connection, tmp_path, 'code', **params)
        assert retry['result']['session_id'] == response['result']['session_id']
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_summary_with_invisible_first_line_gets_a_safe_title(tmp_path, monkeypatch):
    store, _runner, _authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        response = await _create(connection, tmp_path, 'code', execution_mode='code',
                                handoff=_context(source, summary='\u200b\nImplement the requirements'))
        assert 'result' in response, response
        assert response['result']['info']['title']
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_legacy_owner_handoff_links_are_bidirectional(tmp_path, monkeypatch):
    from dataclasses import replace
    from gateway.session_controls import AuthorityConnection
    from gateway.session_identity import authenticated_subject
    store, _runner, authority, old = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    modern = AuthorityConnection(authority, object(), {'provider': 'basic', 'user_id': 'human'})
    old.actor = replace(old.actor, subject=authenticated_subject({'provider': 'basic', 'user_id': 'human'}))
    try:
        source = (await _create(old, tmp_path, 'work'))['result']['session_id']
        response = await _create(modern, tmp_path, 'code', execution_mode='code', handoff=_context(source))
        assert 'result' in response, response
        child = response['result']
        parent = await modern.dispatch({'id': 'info', 'method': 'session.info', 'params': {'session_id': source}})
        assert parent['result']['linked_sessions'][0]['session_id'] == child['session_id']
        assert child['info']['linked_sessions'][0]['session_id'] == source
    finally:
        await modern.close()
        await old.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_links_and_exact_retry_survive_compression_and_reset(tmp_path, monkeypatch):

    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {
        'model': {'default': 'fixture-model', 'api_mode': 'responses'}})
    try:
        source = (await _create(connection, tmp_path, 'work'))['result']['session_id']
        params = dict(execution_mode='code', handoff=_context(source))
        child = (await _create(connection, tmp_path, 'code', **params))['result']['session_id']
        for sid in (source, child):
            authority.persistence.lineage.publish_compression_child(sid,
                CompressionChild(session_id=sid + '-compressed', source='gui', model='fixture-model'),
                [NewMessage(role='user', content='Retained summary')], require_compression_lease=False)
            before = await connection.dispatch({'id': 'resume', 'method': 'session.resume', 'params': {'session_id': sid}})
            snapshot = before['result']
            reset = await connection.dispatch({'id': 'reset', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'reset-' + sid, 'operation': 'reset', 'payload': {},
                'expected_revision': snapshot['revision'], 'expected_generation': snapshot['execution_generation']}})
            assert 'result' in reset, reset
            assert asdict(authority.persistence.bindings.receipt(sid))['entry']['session_id'] != sid
        retry = await _create(connection, tmp_path, 'code', **params)
        assert retry['result']['session_id'] == child
        assert retry['result']['info']['linked_sessions'][0]['session_id'] == source
        parent = await connection.dispatch({'id': 'info', 'method': 'session.info', 'params': {'session_id': source}})
        assert parent['result']['linked_sessions'][0]['session_id'] == child
    finally:
        await connection.close()
        store.close_all_db_handles()
