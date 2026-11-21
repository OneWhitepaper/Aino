"""UI listings route receipt-owned conversations by owner, not physical transcript tip."""

from types import SimpleNamespace

import pytest
import pytest_asyncio
from starlette.testclient import TestClient

from tests.gateway.test_session_create_tier_cwd import _owner
from tests.gateway.test_work_code_handoff import _context, _create


@pytest_asyncio.fixture
async def rotated_home(tmp_path, monkeypatch, profile, rotation):
    import hermes_state
    from hermes_cli import profiles
    from hermes_state import SessionDB
    from hermes_state_local import local_receipt

    default = tmp_path / 'home'
    homes = {'default': default, 'worker': default / 'profiles' / 'worker'}
    for home in homes.values():
        home.mkdir(parents=True)
        (home / 'config.yaml').write_text('{}\n')
    home = homes[profile]
    monkeypatch.setattr(profiles, '_get_default_hermes_home', lambda: default)
    monkeypatch.setattr(profiles, '_get_profiles_root', lambda: default / 'profiles')
    monkeypatch.setattr(hermes_state, 'DEFAULT_DB_PATH', home / 'state.db')
    monkeypatch.setattr('hermes_cli.web_routers.profiles._SIDEBAR_CACHE_TTL_SECONDS', 0)
    workspace = tmp_path / 'workspace'
    workspace.mkdir()
    store, _runner, authority, connection = _owner(home, monkeypatch, {'model': {'default': 'fixture-model'}})
    db = authority.db
    try:
        if rotation == 'adopted-compression':
            from gateway.session_controls import AuthorityConnection

            db.create_session('historical-root', 'desktop', cwd=str(workspace), model='fixture-model')
            db.append_message('historical-root', 'user', 'unadopted history')
            db.publish_compression_child(parent_session_id='historical-root', child_session_id='adopted-owner',
                source='desktop', messages=[{'role': 'user', 'content': 'legacy continuation'}],
                model='fixture-model', require_compression_lease=False)
            await connection.close()
            connection = AuthorityConnection(authority, object(), {
                'provider': 'local', 'user_id': 'human', 'profile_id': authority.profile_id,
                'instance_id': authority.instance_id})
            resumed = await connection.dispatch({'id': 'adopt', 'method': 'session.resume',
                                                'params': {'session_id': 'adopted-owner'}})
            assert 'result' in resumed, resumed
            created = resumed['result']
            owner, root = 'adopted-owner', 'historical-root'
            assert created['session_id'] == owner
        else:
            created = (await _create(connection, workspace, 'conversation'))['result']
            owner = root = created['session_id']
            db.append_message(owner, 'user', 'before rotation')
        target = owner
        if rotation == 'reset-compression':
            reset = await connection.dispatch({'id': 'reset', 'method': 'session.mutate', 'params': {
                'session_id': owner, 'request_id': 'reset', 'operation': 'reset', 'payload': {},
                'expected_revision': created['revision'],
                'expected_generation': created['execution_generation']}})
            assert 'result' in reset, reset
            target = root = reset['result']['target_session_id']
            db.append_message(root, 'user', 'after reset')
        tip = owner + '-tip'
        db.publish_compression_child(parent_session_id=target, child_session_id=tip, source='gui',
            messages=[{'role': 'user', 'content': 'current transcript'}], model='fixture-model',
            require_compression_lease=False)
        receipt = local_receipt(db, owner)
        assert receipt['entry']['session_id'] == tip
        assert receipt['lineage'] == ([owner, target, tip] if target != owner else [owner, tip])
        branched = await _create(connection, workspace, 'branch', execution_mode='code', handoff=_context(owner))
        assert 'result' in branched, branched
        branch = branched['result']['session_id']
        db.append_message(branch, 'user', 'independent reviewed branch')
        for prefix, source in [('legacy', 'desktop'), ('messaging', 'telegram')]:
            db.create_session(prefix + '-root', source, cwd=str(workspace))
            db.append_message(prefix + '-root', 'user', prefix + ' before rotation')
            db.publish_compression_child(parent_session_id=prefix + '-root', child_session_id=prefix + '-tip',
                source=source, messages=[{'role': 'user', 'content': prefix + ' current transcript'}],
                require_compression_lease=False)
        assert db.set_session_pinned(tip, True)
        with SessionDB(db_path=homes['worker' if profile == 'default' else 'default'] / 'state.db') as other:
            other.create_session(tip, 'desktop', cwd=str(workspace))
            other.append_message(tip, 'user', 'another profile has the same physical id')
        yield SimpleNamespace(db=db, home=home, owner=owner, root=root, tip=tip, branch=branch,
                              authority=authority, connection=connection,
                              lineage=([root, owner, tip] if rotation == 'adopted-compression' else receipt['lineage']),
                              profile=profile, owner_in_compression_chain=target == owner)
    finally:
        await connection.close()
        store.close_all_db_handles()


def _tree_rows(projects):
    rows = []
    for project in projects:
        rows.extend(project.get('previewSessions', []))
        rows.extend(_tree_rows(project.get('repos', [])))
    return rows


def _read(client, surface, profile, **params):
    routes = {
        'sessions': ('/api/sessions', {'profile': profile, 'min_messages': 1}),
        'profiles': ('/api/profiles/sessions', {'profile': profile, 'min_messages': 1}),
        'sidebar': ('/api/profiles/sessions/sidebar', {'recents_profile': profile}),
        'projects': ('/api/profiles/projects/tree', {'profile': profile, 'preview_limit': 20}),
    }
    route, query = routes[surface]
    response = client.get(route, params={**query, **params})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert not payload.get('errors'), payload
    if surface == 'sidebar':
        return payload['recents']['sessions']
    if surface == 'projects':
        return _tree_rows(payload['projects'])
    return payload['sessions']


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['compression', 'reset-compression', 'adopted-compression'])
@pytest.mark.parametrize('surface', ['sessions', 'profiles', 'sidebar', 'projects'])
async def test_ui_rows_route_to_the_receipt_owner_without_adopting_other_histories(rotated_home, surface):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_state import SessionDB

    t = rotated_home
    raw = t.db.list_sessions_rich(order_by_last_active=True, compact_rows=True)
    physical = next(row for row in raw if row['id'] == t.tip)
    assert physical['_lineage_root_id'] == t.root
    before = '\n'.join(t.db._conn.iterdump())
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        rows = _read(client, surface, t.profile)
    ids = {row['id'] for row in rows}
    expected = {t.owner, t.branch, 'legacy-tip'}
    if surface != 'projects':
        expected.add('messaging-tip')
    assert ids == expected, 'only receipt-owned local conversations use a logical id at the UI boundary'
    row = next(row for row in rows if row['id'] == t.owner)
    assert row['profile'] == t.profile
    assert row['_lineage_root_id'] == t.root
    assert row['_lineage_ids'] == t.lineage
    assert row['message_count'] == physical['message_count']
    assert row['preview'] == physical['preview']
    if surface != 'projects':
        assert row['pinned'] is True
    assert '\n'.join(t.db._conn.iterdump()) == before, 'listing must not adopt, restore or write state.db'
    with SessionDB(db_path=t.home / 'state.db', read_only=True) as reader:
        assert {row['id'] for row in reader.list_sessions_rich()} == {
            t.tip, t.branch, 'legacy-tip', 'messaging-tip'}, 'raw storage listing keeps its physical-id contract'


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['compression', 'reset-compression', 'adopted-compression'])
async def test_logical_ui_ids_preserve_physical_archive_and_pin_scope(rotated_home):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    t = rotated_home
    assert t.db.set_session_archived(t.tip, True)
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        for surface in ('sessions', 'profiles'):
            rows = _read(client, surface, t.profile, archived='only')
            row = next(row for row in rows if row['id'] == t.owner)
            assert row['archived'] is True and row['pinned'] is True
            assert row['_lineage_root_id'] == t.root
            assert row['_lineage_ids'] == t.lineage
        assert t.owner not in {row['id'] for row in _read(client, 'projects', t.profile)}
    assert t.db.get_session(t.tip)['archived'] == 1
    assert t.db.get_session(t.tip)['pinned'] == 1
    assert t.db.get_session(t.owner)['archived'] == int(t.owner_in_compression_chain)


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
@pytest.mark.parametrize('read', ['messages', 'oldest', 'detail', 'export', 'timeline', 'around'])
async def test_listed_owner_reads_current_reset_segment(rotated_home, read):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_state_runtime import admit_session_input

    t = rotated_home
    t.db.set_session_title(t.tip, 'Current segment title')
    t.db.append_message(t.tip, 'assistant', 'current response')
    # Reads must still work with queued input; the mutation prepare-only snapshot refuses it.
    admit_session_input(t.db, epoch=t.authority.epoch, principal_id=t.connection.actor.subject,
                        session_id=t.owner, request_id='queued-input', payload={'text': 'next turn'})
    before = '\n'.join(t.db._conn.iterdump())
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        sid = next(row['id'] for row in _read(client, 'sessions', t.profile) if row['id'] == t.owner)
        query = {'profile': t.profile}
        suffix = '' if read == 'detail' else '/' + ('messages' if read == 'oldest' else read)
        if read == 'oldest':
            query.update(limit=500, offset=0, order='oldest', include_compacted=True)
        if read == 'around':
            suffix = '/messages/around'
            query['row_id'] = t.db.get_messages(t.tip)[0]['id']
        response = client.get('/api/sessions/' + sid + suffix, params=query)
        assert response.status_code == 200, response.text
        result = response.json()
    if read == 'detail':
        assert result['id'] == sid
        assert result['title'] == 'Current segment title'
        assert result['message_count'] == 2
    elif read == 'timeline':
        assert [entry['preview'] for entry in result['entries']] == ['current transcript']
    else:
        content = [message['content'] for message in result['messages']]
        assert 'current transcript' in content and 'current response' in content
        assert 'before rotation' not in content
        if read in ('messages', 'oldest'):
            assert 'after reset' in content
    assert '\n'.join(t.db._conn.iterdump()) == before, 'stored reads must not adopt or mutate the conversation'
    assert t.db.resolve_resume_session_id(t.owner) == t.owner, 'raw resume deliberately does not cross reset'
    assert [message['content'] for message in t.db.get_messages(t.owner)] == ['before rotation']


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
@pytest.mark.parametrize('field,values', [
    ('archived', (True, False)), ('pinned', (False, True)),
    ('title', ('Current renamed', 'Current renamed again')),
    ('hidden', (True, False)), ('unread', (False, True)),
])
async def test_listed_owner_metadata_targets_current_segment_and_fences_owner(rotated_home, monkeypatch, field, values):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_state_local import local_receipt

    t = rotated_home
    monkeypatch.setattr(app.state, 'session_authority', t.authority, raising=False)
    old_owner = t.db.get_session(t.owner)
    unrelated = {sid: t.db.get_session(sid) for sid in (t.branch, 'legacy-tip', 'messaging-tip')}
    receipt = local_receipt(t.db, t.owner)
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        sid = next(row['id'] for row in _read(client, 'sessions', t.profile) if row['id'] == t.owner)
        path = '/api/sessions/' + sid
        if field == 'archived':
            # Pinned rows intentionally bypass both active/archived filters; unpin through the same HTTP fence.
            snapshot = client.get(path + '/mutation-snapshot', params={'profile': t.profile}).json()
            unpinned = client.patch(path, json={
                'profile': t.profile, 'request_id': 'unpin-before-archive', 'pinned': False,
                'expected_revision': snapshot['runtime_revision'],
                'expected_generation': snapshot['runtime_generation']})
            assert unpinned.status_code == 200, unpinned.text
            assert t.db.get_session(t.tip)['pinned'] == 0
            old_owner = t.db.get_session(t.owner)
        for index, value in enumerate(values):
            snapshot = client.get(path + '/mutation-snapshot', params={'profile': t.profile})
            assert snapshot.status_code == 200, snapshot.text
            snapshot = snapshot.json()
            assert snapshot['runtime_revision'] == old_owner['runtime_revision'] + index
            body = {field: value, 'profile': t.profile, 'request_id': 'metadata-' + str(index),
                    'expected_revision': snapshot['runtime_revision'],
                    'expected_generation': snapshot['runtime_generation']}
            response = client.patch(path, json=body)
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['session_id'] == sid and result['revision'] == snapshot['runtime_revision'] + 1
            assert result['execution_generation'] == old_owner['runtime_generation']
            current = t.db.get_session(t.tip)
            column = 'last_read_at' if field == 'unread' else field
            if field == 'unread':
                assert current[column] == 0 if value else bool(current[column])
            else:
                assert current[column] == value
            assert t.db.get_session(t.owner)[column] == old_owner[column], 'old reset history keeps its metadata'
            if field != 'title':
                assert t.db.get_session(t.root)[column] == current[column], 'flags cover the current compression chain'
            after = '\n'.join(t.db._conn.iterdump())
            retry = client.patch(path, json=body)
            assert retry.status_code == 200 and retry.json() == result
            assert '\n'.join(t.db._conn.iterdump()) == after, 'an exact retry must not mutate or increment twice'
            stale = client.patch(path, json={**body, 'request_id': 'stale-' + str(index)})
            assert stale.status_code == 409 and stale.json()['detail'] == 'revision_conflict'
            if field == 'archived':
                active = {row['id'] for row in _read(client, 'sessions', t.profile)}
                archived = {row['id'] for row in _read(client, 'sessions', t.profile, archived='only')}
                assert (sid in archived) == value
                assert (sid in active) != value
        assert local_receipt(t.db, sid) == receipt, 'metadata does not re-key policy, routing or creation identity'
    assert {sid: t.db.get_session(sid) for sid in unrelated} == unrelated


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
@pytest.mark.parametrize('physical', ['root', 'tip'])
async def test_explicit_physical_metadata_keeps_its_original_fence(rotated_home, monkeypatch, physical):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    t = rotated_home
    monkeypatch.setattr(app.state, 'session_authority', t.authority, raising=False)
    owner_before = t.db.get_session(t.owner)
    sid = getattr(t, physical)
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        path = '/api/sessions/' + sid
        snapshot = client.get(path + '/mutation-snapshot', params={'profile': t.profile}).json()
        response = client.patch(path, json={
            'profile': t.profile, 'request_id': 'physical-archive', 'archived': True,
            'expected_revision': snapshot['runtime_revision'],
            'expected_generation': snapshot['runtime_generation']})
    assert response.status_code == 200, response.text
    assert response.json()['session_id'] == sid
    assert response.json()['revision'] == snapshot['runtime_revision'] + 1
    assert t.db.get_session(t.root)['archived'] == t.db.get_session(t.tip)['archived'] == 1
    assert t.db.get_session(t.owner) == owner_before, 'a physical request does not move the owner fence'


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
async def test_listed_owner_delete_still_retires_the_whole_reset_lineage(rotated_home, monkeypatch):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_state_mutation_retirement import retired_in

    t = rotated_home
    monkeypatch.setattr(app.state, 'session_authority', t.authority, raising=False)
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        sid = next(row['id'] for row in _read(client, 'sessions', t.profile) if row['id'] == t.owner)
        path = '/api/sessions/' + sid
        snapshot = client.get(path + '/mutation-snapshot', params={'profile': t.profile}).json()
        response = client.delete(path, params={
            'profile': t.profile, 'request_id': 'delete-owner',
            'expected_revision': snapshot['runtime_revision'],
            'expected_generation': snapshot['runtime_generation']})
    assert response.status_code == 200, response.text
    assert set(response.json()['deleted_ids']) == set(t.lineage)
    assert all(t.db.get_session(sid) is None for sid in t.lineage)
    with t.db._read_ctx() as conn:
        assert retired_in(conn, t.owner)
    assert t.db.get_session(t.branch) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
@pytest.mark.parametrize('read', ['detail', 'export'])
async def test_exact_physical_metadata_and_export_do_not_follow_legacy_compression(rotated_home, read):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    t = rotated_home
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        for sid, content in [('legacy-root', 'legacy before rotation'), (t.root, 'after reset')]:
            t.db.set_session_title(sid, 'Exact ' + sid)
            suffix = '' if read == 'detail' else '/export'
            response = client.get('/api/sessions/' + sid + suffix, params={'profile': t.profile})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['id'] == sid and result['title'] == 'Exact ' + sid
            if read == 'export':
                assert [message['content'] for message in result['messages']] == [content]


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'worker'])
@pytest.mark.parametrize('rotation', ['reset-compression'])
async def test_unreceipted_empty_parent_http_reads_keep_legacy_descendant_fallback(rotated_home):
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    t = rotated_home
    t.db.create_session('empty-parent', 'cli')
    t.db.create_session('empty-child', 'cli', parent_session_id='empty-parent')
    t.db.create_session('populated-leaf', 'cli', parent_session_id='empty-child')
    row_id = t.db.append_message('populated-leaf', 'user', 'legacy descendant transcript')
    with TestClient(app) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        for suffix in ('/messages', '/timeline', '/messages/around'):
            response = client.get('/api/sessions/empty-parent' + suffix, params={
                'profile': t.profile, **({'row_id': row_id} if suffix.endswith('/around') else {})})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['session_id'] == 'populated-leaf'
            if suffix == '/timeline':
                assert [entry['preview'] for entry in result['entries']] == ['legacy descendant transcript']
            else:
                assert [message['content'] for message in result['messages']] == ['legacy descendant transcript']
