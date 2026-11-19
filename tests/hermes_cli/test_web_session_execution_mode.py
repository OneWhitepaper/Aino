"""Desktop HTTP history must show the same engine as the canonical owner."""

import pytest
from starlette.testclient import TestClient

from tests.gateway.test_session_create_tier_cwd import _owner


@pytest.fixture(autouse=True)
def uncached_sidebar(monkeypatch):
    # Each test owns a different home but uses the same HTTP query parameters.
    monkeypatch.setattr('hermes_cli.web_routers.profiles._SIDEBAR_CACHE_TTL_SECONDS', 0)


@pytest.mark.asyncio
async def test_code_mode_reaches_http_history_and_sidebar(tmp_path, monkeypatch):
    import hermes_state
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    home = tmp_path / 'home'
    monkeypatch.setattr(hermes_state, 'DEFAULT_DB_PATH', home / 'state.db')
    store, _runner, authority, connection = _owner(home, monkeypatch, {'model': {'default': 'fixture-model'}})
    assert authority.db.db_path == home / 'state.db'
    monkeypatch.setattr('hermes_cli.profiles._get_default_hermes_home', lambda: home)
    try:
        created = await connection.dispatch({'id': 'code', 'method': 'session.create', 'params': {
            'request_id': 'code', 'source': 'gui', 'execution_mode': 'code', 'model': 'fixture-model', 'toolsets': []}})
        sid = created['result']['session_id']
        authority.db.append_message(session_id=sid, role='user', content='hello')
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            for route, key in [('/api/sessions?profile=default', 'sessions'),
                               ('/api/profiles/sessions?profile=default', 'sessions'),
                               ('/api/profiles/sessions/sidebar?recents_profile=default', 'recents')]:
                response = client.get(route)
                assert response.status_code == 200, response.text
                payload = response.json()[key]
                rows = payload['sessions'] if key == 'recents' else payload
                row = next(row for row in rows if row['id'] == sid)
                assert row['execution_mode'] == 'code'
            response = client.get(f'/api/sessions/{sid}?profile=default')
            assert response.status_code == 200, response.text
            assert response.json()['execution_mode'] == 'code'
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_sidebar_keeps_reviewed_handoff_drafts_but_not_empty_launch_stubs(tmp_path, monkeypatch):
    import hermes_state
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from tests.gateway.test_work_code_handoff import _create, _context

    home = tmp_path / 'home'
    monkeypatch.setattr(hermes_state, 'DEFAULT_DB_PATH', home / 'state.db')
    monkeypatch.setattr('hermes_cli.profiles._get_default_hermes_home', lambda: home)
    store, _runner, authority, connection = _owner(home, monkeypatch, {'model': {'default': 'fixture-model'}})
    try:
        source = (await _create(connection, tmp_path, 'source'))['result']['session_id']
        authority.db.append_message(session_id=source, role='user', content='Reviewed requirements')
        stub = (await _create(connection, tmp_path, 'stub'))['result']['session_id']
        child = (await _create(connection, tmp_path, 'child', execution_mode='code',
                               handoff=_context(source)))['result']['session_id']
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            detail = client.get(f'/api/sessions/{child}?profile=default').json()
            assert detail['handoff'] == _context(source)
            assert 'handoff' not in client.get(f'/api/sessions/{stub}?profile=default').json()
            routes = [('/api/sessions?profile=default&min_messages=1', 'sessions'),
                      ('/api/profiles/sessions?profile=default&min_messages=1', 'sessions'),
                      ('/api/profiles/sessions/sidebar?recents_profile=default', 'recents')]
            for route, key in routes:
                response = client.get(route)
                assert response.status_code == 200, response.text
                body = response.json()
                rows = body[key]['sessions'] if key == 'recents' else body[key]
                ids = {row['id'] for row in rows}
                assert child in ids, (route, ids)
                assert stub not in ids
                row = next(row for row in rows if row['id'] == child)
                assert row['title'] and row['message_count'] == 0 and row['execution_mode'] == 'code'
                if key == 'sessions':
                    assert body['total'] == 2
            for route, _key in routes[:2]:
                assert client.get(route.replace('min_messages=1', 'min_messages=2')).json()['sessions'] == []
        assert authority.db.get_messages(child) == []
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_unloaded_search_hits_keep_code_work_and_legacy_modes(tmp_path, monkeypatch):
    import hermes_state
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    home = tmp_path / 'home'
    monkeypatch.setattr(hermes_state, 'DEFAULT_DB_PATH', home / 'state.db')
    store, _runner, authority, connection = _owner(home, monkeypatch, {'model': {'default': 'fixture-model'}})
    assert authority.db.db_path == home / 'state.db'
    monkeypatch.setattr('hermes_cli.profiles._get_default_hermes_home', lambda: home)
    try:
        expected = {}
        for mode in ('work', 'code'):
            created = await connection.dispatch({'id': mode, 'method': 'session.create', 'params': {
                'request_id': mode, 'source': 'gui', 'execution_mode': mode,
                'model': 'fixture-model', 'toolsets': []}})
            sid = created['result']['session_id']
            expected[sid] = mode
            authority.db.append_message(session_id=sid, role='user', content='mode-search-fixture')
            authority.db.set_session_title(sid, f'Lookup fixture {mode}')
        authority.db.create_session(session_id='legacy-search', source='cli', model='fixture-model')
        authority.db.append_message(session_id='legacy-search', role='user', content='mode-search-fixture')
        expected['legacy-search'] = 'work'
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            for query in ['"mode-search-fixture"', 'Lookup fixture', *expected]:
                response = client.get('/api/sessions/search', params={'q': query, 'profile': 'default'})
                assert response.status_code == 200, response.text
                rows = response.json()['results']
                assert rows, query
                assert all(row['execution_mode'] == expected[row['session_id']] for row in rows)
            rows = client.get('/api/sessions/search', params={
                'q': '"mode-search-fixture"', 'profile': 'default'}).json()['results']
            assert {row['session_id'] for row in rows} == set(expected)
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
@pytest.mark.parametrize('rotation', ['compression', 'reset'])
async def test_search_preserves_code_mode_after_transcript_rotation(tmp_path, monkeypatch, rotation):
    import hermes_state
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_state_local import local_receipt
    from tests.gateway.test_work_code_handoff import _create

    home = tmp_path / 'home'
    monkeypatch.setattr(hermes_state, 'DEFAULT_DB_PATH', home / 'state.db')
    monkeypatch.setattr('hermes_cli.profiles._get_default_hermes_home', lambda: home)
    store, _runner, authority, connection = _owner(home, monkeypatch, {'model': {'default': 'fixture-model'}})
    try:
        created = (await _create(connection, tmp_path, 'code', execution_mode='code'))['result']
        sid = created['session_id']
        if rotation == 'compression':
            authority.db.append_message(sid, role='user', content='Before compression')
            target = sid + '-compressed'
            authority.db.publish_compression_child(parent_session_id=sid, child_session_id=target,
                source='gui', messages=[{'role': 'user', 'content': 'search-rotation-fixture'}],
                model='fixture-model', require_compression_lease=False)
        else:
            reset = await connection.dispatch({'id': 'reset', 'method': 'session.mutate', 'params': {
                'session_id': sid, 'request_id': 'reset', 'operation': 'reset', 'payload': {},
                'expected_revision': created['revision'], 'expected_generation': created['execution_generation']}})
            assert 'result' in reset, reset
            target = reset['result']['target_session_id']
            authority.db.append_message(target, role='user', content='search-rotation-fixture')
        assert local_receipt(authority.db, sid)['entry']['session_id'] == target
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            response = client.get('/api/sessions/search', params={'q': '"search-rotation-fixture"', 'profile': 'default'})
            assert response.status_code == 200, response.text
            row = next(row for row in response.json()['results'] if row['session_id'] == target)
            assert row['execution_mode'] == 'code'
    finally:
        await connection.close()
        store.close_all_db_handles()
