"""Public export remains complete, owned and usable when writes are disabled."""
import base64
import json
from dataclasses import asdict

import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_history import _setup
from tests.tui_gateway.test_conversation_authority import Peer, caller


def test_export_full_public_package_without_private_or_cross_owner_content(runtime_env, monkeypatch):
    from gateway import hosted_rooms
    from gateway.hosted_room_conversation_content import ConversationContentStore

    _, store, _, home, _ = runtime_env
    _, rpc, call, general = _setup(runtime_env, monkeypatch)
    data = b'full attachment\x00' * 10000
    attachment = call('attach', conversation_id='c', filename='report.bin', mime_type='application/octet-stream',
                      data_base64=base64.b64encode(data).decode())['attachment']
    from gateway.hosted_room_conversation_types import TurnSubmission
    store.append_input('c', TurnSubmission('t', 'i', general, 'public words', (attachment['id'],)))
    with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
        conn.execute('CREATE TABLE private_export_probe(secret TEXT)')
        conn.execute('INSERT INTO private_export_probe VALUES (?)', ('PRIVATE SPOKEN CONTEXT',))
    answer = ('完整 long response 😀\n' * 10000).encode()
    ref = asdict(ConversationContentStore(store.db_path).put_for_conversation('c', answer, 'text/plain; charset=utf-8'))
    state = hosted_rooms.room_state(store.db_path, room_id='c', purpose='conversation')
    hosted_rooms.append_event(store.db_path, room_id='c', purpose='conversation', event_id='response',
        kind='conversation.response', actor={'kind':'participant','id':general,'display_name':'Aino'},
        payload={'text':'', 'content_ref':ref, 'content_status':'referenced'},
        authority_gateway_id=state['authority_gateway_id'], authority_epoch=state['authority_epoch'])
    cfg = yaml.safe_load((home/'config.yaml').read_text())
    cfg['conversations']['enabled'] = False
    cfg['conversations']['storage'] = {'max_total_bytes':1}
    (home/'config.yaml').write_text(yaml.safe_dump(cfg))
    first = call('export', conversation_id='c')
    assert first['filename'].endswith('.json')
    with caller(Peer('stranger')):
        assert 'error' in rpc('export', conversation_id='c', cursor=first['cursor'])
    chunks, cursor = [first['chunk']], first['cursor']
    while cursor is not None:
        page = call('export', conversation_id='c', cursor=cursor)
        chunks.append(page['chunk'])
        cursor = page['cursor']
    package = json.loads(''.join(chunks))
    assert 'PRIVATE SPOKEN CONTEXT' not in ''.join(chunks)
    assert str(home) not in ''.join(chunks)
    assert [event['event_id'] for event in package['events']] == [event['event_id'] for event in store.events('c').events]
    contents = {item['reference']['id']:b''.join(base64.b64decode(chunk) for chunk in item['data_base64_chunks']) for item in package['content']}
    assert contents == {ref['id']:answer, attachment['content_ref']['id']:data}


def test_export_refuses_changed_snapshot_and_accepts_empty_owned_history(runtime_env, monkeypatch):
    _, store, _, _, _ = runtime_env
    _, rpc, call, _ = _setup(runtime_env, monkeypatch)
    first = call('export', conversation_id='c')
    call('rename', conversation_id='c', title='Changed', expected_revision=store.get('c').revision)
    assert 'error' in rpc('export', conversation_id='c', cursor=first['cursor'])
    chunks, cursor = [], None
    while True:
        page = call('export', conversation_id='c', cursor=cursor)
        chunks.append(page['chunk'])
        cursor = page['cursor']
        if cursor is None:
            break
    package = json.loads(''.join(chunks))
    assert package['title'] == 'Changed' and package['events'] == [] and package['content'] == []
