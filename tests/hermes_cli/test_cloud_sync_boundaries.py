"""Private review regressions for portable ownership, pagination and crash recovery."""
import base64
import uuid

import pytest

from hermes_cli.cloud_sync import dispatch
from hermes_state import SessionDB
from tests.hermes_cli.test_cloud_sync import Cloud, call, seed, sync


def test_receipt_can_precede_change_cursor_and_replay_next_page(tmp_path):
    home = tmp_path / 'home'
    db = seed(home)
    cloud = Cloud()
    prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
    response = cloud.exchange(prepared['exchange'])
    record = response['results'][0]['record']
    response.update(cursor='0', has_more=True, changes=[])
    result = call(home, 'apply', request_id=prepared['request_id'], response=response)
    assert result['status']['cursor'] == '0' and result['has_more']
    assert call(home, 'apply', request_id=prepared['request_id'], response=response) == result
    next_page = call(home, 'prepare', request_id=str(uuid.uuid4()))
    assert next_page['exchange']['after'] == '0' and not next_page['exchange']['operations']
    call(home, 'apply', request_id=next_page['request_id'], response={
        'cursor': '1', 'has_more': False, 'results': [], 'changes': [record]})
    assert len(db.get_messages('conversation')) == 2
    assert call(home, 'status')['status']['cursor'] == '1'
    db.close()


def test_separate_ui_store_rejects_lexical_parent_escape(tmp_path):
    home, ui = tmp_path / 'home', tmp_path / 'ui'
    (ui / 'attachments').mkdir(parents=True)
    outside = tmp_path / 'outside.png'
    outside.write_bytes(b'FABRICATED-OUTSIDE-FILE')
    db = seed(home)
    db.append_message('conversation', 'user', [{'type': 'image_url', 'image_url': {
        'url': str(ui / 'attachments' / '..' / '..' / 'outside.png')}}])
    result = dispatch(dict(version=1, action='prepare', home=str(home), ui_root=str(ui), request_id=str(uuid.uuid4())))
    assert result['status']['state'] == 'blocked'
    assert not result['uploads'] and not result['exchange']['operations']
    db.close()


def test_replacement_preserves_local_authority_project_billing_and_prompt(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    db_a = seed(a)
    cloud = Cloud()
    sync(a, cloud)
    sync(b, cloud)
    db_b = SessionDB(b / 'state.db')
    def bind_local(conn):
        prompt_hash = db_b._store_system_prompt(conn, 'LOCAL PROMPT')
        conn.execute('''UPDATE sessions SET user_id='local-owner',cwd='/local/project',git_repo_root='/local/project',
            git_branch='local-branch',billing_provider='local-provider',billing_base_url='https://local.test',
            billing_mode='local',system_prompt_hash=?,system_prompt='legacy local prompt' WHERE id='conversation' ''', (prompt_hash,))
    db_b._execute_write(bind_local)
    before = db_b.get_session('conversation')
    db_a.append_message('conversation', 'assistant', 'new remote reply')
    sync(a, cloud)
    sync(b, cloud)
    after = db_b.get_session('conversation')
    for field in ('user_id', 'cwd', 'git_repo_root', 'git_branch', 'billing_provider', 'billing_base_url',
                  'billing_mode', 'system_prompt', 'system_prompt_hash'):
        assert after.get(field) == before.get(field), field
    assert db_b.get_messages('conversation')[-1]['content'] == 'new remote reply'
    db_a.close()
    db_b.close()


def _pending_image(a, b):
    db = seed(a)
    (a / 'images').mkdir()
    content = b'\x89PNG\r\n\x1a\ncomplete-image'
    (a / 'images' / 'pic.png').write_bytes(content)
    db.append_message('conversation', 'user', [{'type': 'image_url', 'image_url': {'url': str(a / 'images' / 'pic.png')}}])
    cloud = Cloud()
    prepared = call(a, 'prepare', request_id=str(uuid.uuid4()))
    blob = call(a, 'read_blob', sha256=prepared['uploads'][0]['sha256'])
    call(a, 'apply', request_id=prepared['request_id'], response=cloud.exchange(prepared['exchange']))
    prepared = call(b, 'prepare', request_id=str(uuid.uuid4()))
    response = cloud.exchange(prepared['exchange'])
    missing = call(b, 'apply', request_id=prepared['request_id'], response=response)['pending_downloads']
    db.close()
    return prepared, response, blob, missing


def test_partial_download_is_requested_again_and_display_copy_is_repaired(tmp_path):
    a, b = tmp_path / 'a', tmp_path / 'b'
    prepared, response, blob, missing = _pending_image(a, b)
    path = b / 'cloud-sync' / 'media' / missing[0]
    path.parent.mkdir(parents=True)
    path.write_bytes(b'\x89PNG')
    display = path.with_suffix('.png')
    display.write_bytes(b'truncated display')
    pending = call(b, 'prepare', request_id=str(uuid.uuid4()))
    result = call(b, 'apply', request_id=pending['request_id'], response=pending['pending_response'])
    assert result['pending_downloads'] == missing
    result = call(b, 'apply', request_id=prepared['request_id'], response=response, blobs=[blob])
    assert not result['pending_downloads']
    expected = base64.b64decode(blob['data_base64'])
    assert path.read_bytes() == display.read_bytes() == expected


def test_media_publication_is_atomic_and_verified_bytes_are_immutable(tmp_path, monkeypatch):
    from hermes_cli import cloud_sync_media
    path = tmp_path / 'cloud-sync' / 'media' / 'blob'
    cloud_sync_media.publish_media(tmp_path, path, b'verified original')
    original_stat = path.stat()
    cloud_sync_media.publish_media(tmp_path, path, b'verified original')
    assert path.stat().st_mtime_ns == original_stat.st_mtime_ns
    def interrupted(*args, **kwargs):
        assert path.read_bytes() == b'verified original'
        raise OSError('publication interrupted')
    monkeypatch.setattr(cloud_sync_media.os, 'replace', interrupted)
    with pytest.raises(OSError, match='publication interrupted'):
        cloud_sync_media.publish_media(tmp_path, path, b'replacement')
    assert path.read_bytes() == b'verified original'
    assert list(path.parent.iterdir()) == [path]
