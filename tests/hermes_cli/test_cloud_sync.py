"""Durable account history exchange through real isolated SessionDB homes."""
import copy
import uuid

import pytest

from hermes_state import SessionDB


def call(home, action, **extra):
    from hermes_cli.cloud_sync import dispatch
    home.mkdir(exist_ok=True)
    return dispatch(dict(version=1, action=action, home=str(home), ui_root=str(home / 'ui'), **extra))


class Cloud:
    def __init__(self):
        self.records = {}
        self.receipts = {}
        self.revision = 0

    def exchange(self, request):
        results = []
        for op in request['operations']:
            oid = op['operation_id']
            if oid not in self.receipts:
                current = self.records.get(op['key'])
                if (current or {}).get('revision', '0') != op['base_revision'] or (current or {}).get('deleted'):
                    result = dict(operation_id=oid, status='conflict', record=copy.deepcopy(current))
                else:
                    self.revision += 1
                    current = dict(key=op['key'], revision=str(self.revision), deleted=op['deleted'],
                                   payload=op.get('payload'), device_id=request['device_id'])
                    self.records[op['key']] = current
                    result = dict(operation_id=oid, status='applied', record=copy.deepcopy(current))
                self.receipts[oid] = result
            results.append(copy.deepcopy(self.receipts[oid]))
        changes = [copy.deepcopy(row) for row in self.records.values() if int(row['revision']) > int(request['after'])]
        return dict(cursor=str(self.revision), has_more=False, results=results, changes=changes)


def sync(home, cloud):
    prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
    response = prepared.get('pending_response') or cloud.exchange(prepared['exchange'])
    return call(home, 'apply', request_id=prepared['request_id'], response=response, blobs=prepared['uploads'])


def seed(home, text='hello', sid='conversation'):
    home.mkdir(exist_ok=True)
    db = SessionDB(home / 'state.db')
    db.create_session(sid, 'cli', model='test-model', model_config={'api_key': 'NEVER-SYNC', 'temperature': 0.3})
    db.append_message(sid, 'user', text, message_uid='u-first')
    db.append_message(sid, 'assistant', 'first answer', message_uid='a-first')
    return db


def test_two_home_continuation_and_retry(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    assert 'NEVER-SYNC' not in str(prepared)
    retry = call(a, 'prepare', request_id=str(uuid.uuid4()))
    assert retry['request_id'] == prepared['request_id']
    assert retry['exchange'] == prepared['exchange']
    response = cloud.exchange(prepared['exchange'])
    call(a, 'apply', request_id=prepared['request_id'], response=response)
    call(a, 'apply', request_id=prepared['request_id'], response=response)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    assert [m['content'] for m in db_b.get_messages('conversation')] == ['hello', 'first answer']
    db_b.append_message('conversation', 'user', 'next question')
    db_b.append_message('conversation', 'assistant', 'next answer')
    sync(b, cloud)
    sync(a, cloud)
    assert [m['content'] for m in db_a.get_messages('conversation')] == ['hello', 'first answer', 'next question', 'next answer']
    assert db_a.get_messages('conversation')[0]['message_uid'] == 'u-first'
    db_a.close()
    db_b.close()


def test_unprepared_response_rejected(tmp_path):
    with pytest.raises(ValueError, match='preparation'):
        call(tmp_path / 'a', 'apply', request_id=str(uuid.uuid4()),
             response=dict(cursor='0', has_more=False, results=[], changes=[]))


def test_concurrent_offline_edits_create_visible_conflict(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    db_a.append_message('conversation', 'user', 'A edit')
    db_b.append_message('conversation', 'user', 'B edit')
    sync(a, cloud)
    sync(b, cloud)
    assert db_b.get_messages('conversation')[-1]['content'] == 'A edit'
    copies = [s for s in db_b.search_sessions(limit=100) if s['id'] != 'conversation']
    assert len(copies) == 1
    assert 'sync conflict' in copies[0]['title']
    assert not copies[0]['hidden']
    assert db_b.get_messages(copies[0]['id'])[-1]['content'] == 'B edit'
    assert sync(b, cloud)['status']['state'] == 'synced'
    db_a.close()
    db_b.close()


def test_remote_deletion_preserves_offline_edit_as_conflict(tmp_path):
    from hermes_state_mutation_retirement import delete_in_transaction
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    db_b.append_message('conversation', 'user', 'offline work')
    db_a._execute_write(lambda c: delete_in_transaction(db_a, c, 'conversation', {}))
    sync(a, cloud)
    sync(b, cloud)
    assert db_b.get_session('conversation') is None
    copies = db_b.search_sessions(limit=100)
    assert len(copies) == 1
    assert db_b.get_messages(copies[0]['id'])[-1]['content'] == 'offline work'
    sync(b, cloud)
    assert cloud.records['conversation/default/conversation']['deleted']
    db_a.close()
    db_b.close()


def test_busy_inbound_defers_cursor_and_replays_after_restart(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_a.append_message('conversation', 'user', 'new remote turn')
    sync(a, cloud)
    db_b = SessionDB(b / 'state.db')
    assert db_b.try_acquire_session_turn_lease('conversation', 'cloud-sync-test')
    prepared = call(b, 'prepare', request_id=str(uuid.uuid4()))
    response = cloud.exchange(prepared['exchange'])
    result = call(b, 'apply', request_id=prepared['request_id'], response=response)
    assert result['status']['cursor'] == '1'
    assert result['status']['state'] == 'blocked'
    retried = call(b, 'prepare', request_id=str(uuid.uuid4()))
    assert retried['pending_response'] == response
    assert retried['request_id'] == prepared['request_id']
    assert len(db_b.get_messages('conversation')) == 2
    db_b.release_session_turn_lease('conversation', 'cloud-sync-test')
    result = call(b, 'apply', request_id=retried['request_id'], response=retried['pending_response'])
    assert result['status']['cursor'] == '2'
    assert len(db_b.get_messages('conversation')) == 3
    db_a.close()
    db_b.close()


def test_media_is_incremental_hash_checked_and_private(tmp_path):
    import base64
    import hashlib
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    (a / 'images').mkdir()
    media = a / 'images' / 'image.png'
    media.write_bytes(b'\x89PNG\r\n\x1a\nfirst-image')
    db_a.append_message('conversation', 'user', [{'type': 'image_url', 'image_url': {'url': str(media)}}])
    second = a / 'images' / 'second.png'
    second.write_bytes(b'second-image')
    db_a.append_message('conversation', 'assistant', [{'type': 'image_url', 'image_url': {'url': str(second)}}])
    cloud = Cloud()
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    assert all('data_base64' not in item for item in prepared['uploads'])
    blobs = [call(a, 'read_blob', sha256=item['sha256']) for item in prepared['uploads']]
    response = cloud.exchange(prepared['exchange'])
    call(a, 'apply', request_id=prepared['request_id'], response=response)
    prepared_b = call(b, 'prepare', request_id=str(uuid.uuid4()))
    response_b = cloud.exchange(prepared_b['exchange'])
    result = call(b, 'apply', request_id=prepared_b['request_id'], response=response_b)
    assert len(result['pending_downloads']) == 2
    result = call(b, 'apply', request_id=prepared_b['request_id'], response=response_b, blobs=[blobs[0]])
    assert len(result['pending_downloads']) == 1
    result = call(b, 'apply', request_id=prepared_b['request_id'], response=response_b, blobs=[blobs[1]])
    assert not result['pending_downloads']
    db_b = SessionDB(b / 'state.db')
    for msg in db_b.get_messages('conversation')[2:]:
        path = __import__('pathlib').Path(msg['content'][0]['image_url']['url'])
        assert path.is_relative_to(b)
        assert path.stat().st_mode & 0o077 == 0
        assert hashlib.sha256(path.read_bytes()).hexdigest() == path.stem
    assert call(b, 'prepare', request_id=str(uuid.uuid4()))['exchange']['operations'] == []
    db_a.close()
    db_b.close()


@pytest.mark.parametrize('kind', ['escape', 'missing', 'oversize'])
def test_unavailable_media_blocks_snapshot(tmp_path, kind):
    a = tmp_path / 'a'
    db = seed(a)
    (a / 'images').mkdir()
    path = a / 'images' / 'media.png'
    if kind == 'escape':
        outside = tmp_path / 'private.txt'
        outside.write_text('secret')
        path.symlink_to(outside)
    elif kind == 'oversize':
        with path.open('wb') as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
    db.append_message('conversation', 'user', [{'type': 'image_url', 'image_url': {'url': str(path)}}])
    result = call(a, 'prepare', request_id=str(uuid.uuid4()))
    assert result['status']['state'] == 'blocked'
    assert not result['exchange']['operations']
    db.close()


def test_profile_identity_and_archive_flags_are_portable(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    bot = a / 'profiles' / 'bot-one'
    bot.mkdir(parents=True)
    (bot / 'profile.yaml').write_text('display_name: Researcher\ndescription: Looks up facts\n')
    (bot / 'config.yaml').write_text('model:\n  model: safe-model\n  api_key: NEVER-PUBLISH\nterminal:\n  cwd: /private/project\n')
    db = seed(bot, sid='bot-chat')
    db._execute_write(lambda c: c.execute("UPDATE messages SET active=0,compacted=1 WHERE role='user'"))
    db.set_session_archived('bot-chat', True)
    cloud = Cloud()
    sync(a, cloud)
    assert 'NEVER-PUBLISH' not in str(cloud.records)
    sync(b, cloud)
    restored = SessionDB(b / 'profiles' / 'bot-one' / 'state.db')
    assert restored.get_session('bot-chat')['profile_name'] == 'bot-one'
    assert restored.get_session('bot-chat')['archived']
    assert len(restored.get_messages('bot-chat')) == 1
    archived = restored.get_messages('bot-chat', include_inactive=True)[0]
    assert not archived['active'] and archived['compacted']
    assert 'Researcher' in (b / 'profiles' / 'bot-one' / 'profile.yaml').read_text()
    db.close()
    restored.close()


def test_unknown_execution_blocks_export_and_inbound(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    db_b._execute_write(lambda c: c.execute(
        "INSERT INTO worker_executions(execution_id,session_id,kind,owner_epoch,generation,status,adoption_digest) "
        "VALUES('worker','conversation','compute',1,1,'unknown','digest')"))
    db_a.append_message('conversation', 'user', 'remote edit')
    sync(a, cloud)
    prepared = call(b, 'prepare', request_id=str(uuid.uuid4()))
    assert prepared['status']['issues'][0]['code'] == 'unknown_execution'
    result = call(b, 'apply', request_id=prepared['request_id'], response=cloud.exchange(prepared['exchange']))
    assert result['status']['cursor'] == '1'
    assert len(db_b.get_messages('conversation')) == 2
    db_b._execute_write(lambda c: c.execute("UPDATE worker_executions SET status='terminal'"))
    prepared = call(b, 'prepare', request_id=str(uuid.uuid4()))
    result = call(b, 'apply', request_id=prepared['request_id'], response=prepared['pending_response'])
    assert result['status']['cursor'] == '2'
    db_a.close()
    db_b.close()


def test_local_media_failure_stays_visible_after_empty_exchange(tmp_path):
    a = tmp_path / 'a'
    db = seed(a)
    db.append_message('conversation', 'user', [{'type': 'image_url', 'image_url': {'url': str(a / 'images' / 'missing.png')}}])
    result = sync(a, Cloud())
    assert result['status']['state'] == 'blocked'
    assert result['status']['issues']
    db.close()


def test_tool_arguments_do_not_read_local_files(tmp_path):
    a = tmp_path / 'a'
    db = seed(a)
    secret = a / '.env'
    secret.write_text('HIDDEN_VALUE')
    db.append_message('conversation', 'assistant', tool_calls=[{
        'id': 'call1', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":"' + str(secret) + '"}'}}])
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    assert prepared['exchange']['operations']
    assert 'HIDDEN_VALUE' not in str(prepared)
    db.close()


@pytest.mark.parametrize('injection', ['model_config', 'profile'])
def test_inbound_authority_is_rejected(tmp_path, injection):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db = seed(a)
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    response = Cloud().exchange(prepared['exchange'])
    remote = response['changes'][0]
    if injection == 'model_config':
        remote['payload']['segments'][0]['model_config']['yolo'] = True
    else:
        remote['payload']['profile']['config']['hooks'] = {'session_start': 'rm -rf anything'}
    prepared_b = call(b, 'prepare', request_id=str(uuid.uuid4()))
    with pytest.raises(ValueError, match='unportable'):
        call(b, 'apply', request_id=prepared_b['request_id'], response=dict(
            cursor='1', has_more=False, results=[], changes=[remote]))
    target = SessionDB(b / 'state.db')
    assert target.get_session('conversation') is None
    assert call(b, 'status')['status']['cursor'] == '0'
    db.close()
    target.close()


def test_compression_lineage_retains_live_context_and_uids(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db = seed(a)
    db.end_session('conversation', 'compression')
    db.create_session('tip', 'cli', parent_session_id='conversation')
    db.append_message('tip', 'assistant', 'summary', _compressed_summary=True, message_uid='summary-uid')
    db.append_message('tip', 'user', 'after compression', message_uid='post-user')
    db.append_message('tip', 'assistant', 'current reply', message_uid='post-assistant')
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    target = SessionDB(b / 'state.db')
    assert target.get_compression_tip('conversation') == 'tip'
    assert target.get_session('tip')['parent_session_id'] == 'conversation'
    model, display = target.get_resume_conversations('tip')
    assert 'summary' in [m['content'] for m in model]
    assert 'hello' in [m['content'] for m in display]
    assert target.get_messages('tip')[0]['message_uid'] == 'summary-uid'
    assert call(b, 'prepare', request_id=str(uuid.uuid4()))['exchange']['operations'] == []
    db.close()
    target.close()


def test_markdown_and_composer_image_references_are_portable(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db = seed(a)
    (a / 'images').mkdir()
    image = a / 'images' / 'photo.png'
    image.write_bytes(b'\x89PNG\r\n\x1a\nbytes')
    db.append_message('conversation', 'user', f'[The user attached an image: photo.png]\n[Examine it with the vision_analyze tool using image_url: {image}]')
    db.append_message('conversation', 'assistant', f'![photo]({image})')
    cloud = Cloud()
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    blobs = [call(a, 'read_blob', sha256=item['sha256']) for item in prepared['uploads']]
    response = cloud.exchange(prepared['exchange'])
    call(a, 'apply', request_id=prepared['request_id'], response=response)
    prepared_b = call(b, 'prepare', request_id=str(uuid.uuid4()))
    call(b, 'apply', request_id=prepared_b['request_id'], response=cloud.exchange(prepared_b['exchange']), blobs=blobs)
    target = SessionDB(b / 'state.db')
    messages = target.get_messages('conversation')
    assert str(a) not in messages[-1]['content']
    assert str(b / 'cloud-sync' / 'media') in messages[-1]['content']
    assert '.png)' in messages[-1]['content']
    assert '.png]' in messages[-2]['content']
    db.close()
    target.close()


def test_sync_tombstone_retires_canonical_receipts_and_blocks_recreation(tmp_path):
    import hermes_state_runtime as rt
    from hermes_state_mutation_retirement import delete_in_transaction
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    epoch = rt.begin_runtime_epoch(db_b, instance_id='b')
    admission = rt.admit_session_input(db_b, epoch=epoch, principal_id='human', session_id='conversation',
                                       request_id='already-done', payload={'text': 'hello'})
    claimed = rt.claim_session_input(db_b, epoch=epoch, session_id='conversation')
    rt.settle_session_input(db_b, epoch=epoch, admission_id=admission['admission_id'],
                            generation=claimed['generation'], outcome='completed')
    db_a._execute_write(lambda c: delete_in_transaction(db_a, c, 'conversation', {}))
    sync(a, cloud)
    result = sync(b, cloud)
    assert result['status']['state'] == 'synced'
    assert db_b.get_session('conversation') is None
    assert not db_b._read_all('PRAGMA foreign_key_check')
    with pytest.raises(rt.RuntimeStoreError, match='not_found'):
        rt.admit_session_input(db_b, epoch=epoch, principal_id='human', session_id='conversation',
                               request_id='new-turn', payload={'text': 'must not resurrect'})
    db_a.close()
    db_b.close()


def test_completed_poll_receipts_are_bounded_without_evicting_pending(tmp_path):
    home = tmp_path / 'a'
    cloud = Cloud()
    first = None
    for _ in range(130):
        prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
        response = cloud.exchange(prepared['exchange'])
        call(home, 'apply', request_id=prepared['request_id'], response=response)
        first = first or (prepared['request_id'], response)
    with pytest.raises(ValueError, match='preparation'):
        call(home, 'apply', request_id=first[0], response=first[1])
    db = SessionDB(home / 'state.db')
    from hermes_state_cloud_sync import get_meta
    from hermes_cli.cloud_sync_engine import STATE_KEY
    with db._read_ctx() as conn:
        state = get_meta(conn, STATE_KEY)
    assert len(state['receipts']) == 128
    pending = call(home, 'prepare', request_id=str(uuid.uuid4()))
    assert call(home, 'prepare', request_id=str(uuid.uuid4()))['request_id'] == pending['request_id']
    db.close()


def test_initial_backlog_is_bounded_and_status_stays_pending(tmp_path):
    home = tmp_path / 'a'
    db = seed(home)
    for n in range(16):
        sid = f'extra-{n}'
        db.create_session(sid, 'cli')
        db.append_message(sid, 'user', 'hello')
    cloud = Cloud()
    prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
    assert len(prepared['exchange']['operations']) == 1
    result = call(home, 'apply', request_id=prepared['request_id'], response=cloud.exchange(prepared['exchange']))
    assert result['status']['state'] == 'pending'
    for _ in range(16):
        result = sync(home, cloud)
    assert result['status']['state'] == 'synced'
    assert len(cloud.records) == 17
    db.close()
