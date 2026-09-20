"""Full conversation content survives restarts; quota refusal never creates an ownership link."""
import pytest
from gateway.hosted_room_conversation_content import ConversationContentStore, ContentQuotaError
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef


def test_durable_content_ownership_and_quota(tmp_path):
    db = tmp_path / 'shared-state.db'
    store = ConversationStore(db)
    general = ParticipantRef('general', 'install', 'default', 'Aino', True)
    store.create('c1', 'One', general, None)
    store.create('c2', 'Two', general, None)
    text = '完整长答案' * 20000
    content = ConversationContentStore(db)
    ref = content.put_for_conversation('c1', text.encode(), 'text/plain; charset=utf-8')
    assert ConversationContentStore(db).read_for_conversation('c1', ref.id).decode() == text
    assert content.put_for_conversation('c1', text.encode(), ref.mime_type) == ref
    from dataclasses import asdict
    assert content.validate_reference('c1', asdict(ref)) == ref
    for malformed in ({}, None, [], {'id': ref.id},
                      {**asdict(ref), 'sha256': 'forged'},
                      {**asdict(ref), 'size_bytes': ref.size_bytes + 1},
                      {**asdict(ref), 'mime_type': 'image/png'}):
        with pytest.raises(ValueError):
            content.validate_reference('c1', malformed)
    with pytest.raises(ValueError):
        content.read_for_conversation('c2', ref.id)
    (tmp_path / 'config.yaml').write_text('conversations:\n  storage:\n    max_conversation_bytes: 1\n')
    with pytest.raises(ContentQuotaError):
        content.associate('c2', ref.id)
    with pytest.raises(ValueError):
        content.read_for_conversation('c2', ref.id)


def test_content_admission_rejects_invalid_budgets_and_low_disk_atomically(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from gateway import hosted_rooms
    from gateway import hosted_room_conversation_content as module
    db = tmp_path / 'shared-state.db'
    store = ConversationStore(db)
    store.create('c', 'One', ParticipantRef('general', 'install', 'default', 'Aino', True), None)
    content = ConversationContentStore(db)
    config = tmp_path / 'config.yaml'
    for invalid in ('-1', '.inf', 'true', '1099511627777'):
        config.write_text(f'conversations:\n  storage:\n    max_content_bytes: {invalid}\n')
        with pytest.raises(ValueError):
            content.put_for_conversation('c', b'rejected', 'text/plain')
    config.write_text('conversations:\n  storage:\n    max_content_bytes: 1\n')
    with pytest.raises(ContentQuotaError):
        content.put_for_conversation('c', b'rejected', 'text/plain')
    config.write_text('{}')
    for mime in ('text/plain\0', 'text/\nplain', 'text/plain\x7f'):
        with pytest.raises(ValueError):
            content.put(b'x', mime)
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=0))
    with pytest.raises(ContentQuotaError):
        content.put_for_conversation('c', b'rejected', 'text/plain')
    with hosted_rooms._transaction(db) as conn:
        assert conn.execute('SELECT count(*) FROM hosted_conversation_content').fetchone()[0] == 0
        assert conn.execute('SELECT count(*) FROM hosted_conversation_content_owners').fetchone()[0] == 0
    assert store.events('c').events == ()
