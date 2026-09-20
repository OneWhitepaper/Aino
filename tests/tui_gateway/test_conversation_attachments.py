"""Owned shared attachments survive participant changes across real agent HTTP turns."""
import base64
import json
import threading
from http.server import HTTPServer
from io import BytesIO

import pytest
import yaml
from PIL import Image

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_authority import Peer, caller


def service_rpc(server, store, monkeypatch):
    from tui_gateway.hosted_room_service import HostedRoomService
    hosted = HostedRoomService(server, db_path=store.db_path)
    monkeypatch.setattr(server, 'get_conversation_service', lambda: hosted.conversations)
    def rpc(method, **params):
        return server._methods['conversations.' + method]('attachment-test', params)
    return hosted, rpc


def test_upload_authority_paging_and_rejected_admission(runtime_env, monkeypatch):
    server, store, install, home, root = runtime_env
    hosted, rpc = service_rpc(server, store, monkeypatch)
    catalog = hosted.conversations.catalog()
    general = next(r['participant']['participant_id'] for r in catalog if r['participant']['is_general'])
    hosted.conversations.create('c', 'Attachments', general)
    hosted.conversations.create('other', 'Other', general)
    payload = '完整文本'.encode() * 100
    args = dict(conversation_id='c', filename='../folder\\notes.txt', mime_type='text/plain',
                data_base64=base64.b64encode(payload).decode())
    result = rpc('attach', **args)['result']['attachment']
    assert result['filename'] == 'notes.txt'
    assert rpc('attach', **args)['result']['attachment'] == result
    offset, chunks = 0, []
    while True:
        page = rpc('content', conversation_id='c', content_id=result['content_ref']['id'],
                   offset_bytes=offset, limit_bytes=7)['result']
        chunks.append(base64.b64decode(page['data_base64']))
        assert page['next_offset'] > offset
        offset = page['next_offset']
        if not page['has_more']:
            break
    assert b''.join(chunks) == payload
    assert 'error' in rpc('content', conversation_id='other', content_id=result['content_ref']['id'])
    with caller(Peer('stranger')):
        assert 'error' in rpc('attach', **args)
        assert 'error' in rpc('content', conversation_id='c', content_id=result['content_ref']['id'])
    before = store.get('other')
    assert 'error' in rpc('send', conversation_id='other', turn_id='t', input_id='i',
                         participant_id=general, text='keep draft', attachment_ids=[result['id']],
                         expected_revision=before.revision)
    assert store.get('other') == before and not store.events('other').events
    before = store.get('c')
    for extra in ({'data_base64': 'invalid!'}, {'mime_type': 'image/png'}, {'path': '/private/key'}):
        assert 'error' in rpc('attach', **{**args, **extra})
    cfg = yaml.safe_load((home / 'config.yaml').read_text())
    cfg['conversations']['storage'] = {'max_content_bytes': 1}
    (home / 'config.yaml').write_text(yaml.safe_dump(cfg))
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    scope = set_hermes_home_override(home / 'profiles' / 'writer')
    try:
        assert rpc('capabilities')['result']['max_attachment_bytes'] == 1
        from gateway.hosted_room_conversation_store import _MAX_ATTACHMENTS
        assert rpc('capabilities')['result']['max_attachments'] == _MAX_ATTACHMENTS
        assert 'error' in rpc('attach', **args)
        boundary = rpc('attach', **{**args, 'data_base64': base64.b64encode(b'x').decode()})
        assert boundary['result']['attachment']['content_ref']['size_bytes'] == 1
    finally:
        reset_hermes_home_override(scope)
    assert store.get('c') == before and not store.events('c').events


def test_image_and_text_are_available_to_later_participant_with_exact_receipts(runtime_env, monkeypatch):
    from tests.agent.test_api_content_sidecar import _MockHandler
    from gateway import hosted_room_driver as driver
    server, store, install, home, root = runtime_env
    _MockHandler.captured_requests, _MockHandler.response_queue = [], []
    http = HTTPServer(('127.0.0.1', 0), _MockHandler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    for cfg_path in (home / 'config.yaml', home / 'profiles' / 'writer' / 'config.yaml'):
        cfg = yaml.safe_load(cfg_path.read_text())
        cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
        cfg['agent']['image_input_mode'] = 'native'
        cfg['model']['supports_vision'] = True
        cfg['compression'] = {'enabled': False}
        cfg_path.write_text(yaml.safe_dump(cfg))
    hosted, rpc = service_rpc(server, store, monkeypatch)
    def call(method, **params):
        response = rpc(method, **params)
        assert 'error' not in response, response
        return response['result']
    try:
        catalog = call('participants')['participants']
        general = next(r['participant']['participant_id'] for r in catalog if r['participant']['is_general'])
        writer = next(r['participant']['participant_id'] for r in catalog if r['participant']['profile'] == 'writer')
        call('create', conversation_id='c', title='Attachments', general_participant_id=general)
        png = BytesIO()
        Image.new('RGB', (8, 8), 'red').save(png, format='PNG')
        private_image = root / 'private-only.png'
        Image.new('RGB', (8, 8), 'blue').save(private_image, format='PNG')
        attachments = [call('attach', conversation_id='c', filename=name, mime_type=mime,
                            data_base64=base64.b64encode(data).decode())['attachment']
                       for name, mime, data in [('picture.png', 'image/png', png.getvalue()),
                                               ('notes.txt', 'text/plain', b'shared narrative fact')]]
        first_event = None
        for index, participant in enumerate((general, writer, general)):
            prepared = call('prepare', conversation_id='c', participant_id=participant)
            session = server._sessions[prepared['session_id']]
            queue_before = list(session.get('attached_images', []))
            for method, params in (
                ('clipboard.paste', {}), ('image.attach', {'path': '/private/other.png'}),
                ('image.attach_bytes', {'content_base64': base64.b64encode(png.getvalue()).decode()}),
                ('pdf.attach', {'path': '/private/other.pdf'}),
                ('file.attach', {'path': '/private/secret'}),
                ('image.detach', {'path': '/private/other.png'}),
                ('input.detect_drop', {'text': '/private/other.png'}),
            ):
                blocked = server._methods[method]('legacy', {'session_id': prepared['session_id'], **params})
                assert blocked['error']['code'] == 4120, blocked
            assert session.get('attached_images', []) == queue_before
            revision = call('get', conversation_id='c')['conversation']['revision']
            admission = call('send', conversation_id='c', turn_id=f't{index}', input_id=f'i{index}',
                participant_id=participant, text='' if index == 0 else 'Inspect shared attachments', expected_revision=revision,
                attachment_ids=[a['id'] for a in attachments] if index == 0 else [])['admission']
            first_event = first_event or admission['event_id']
            if index < 2:
                for cached in (home / 'conversation-materialized' / 'attachments').iterdir():
                    cached.unlink()
            session['attached_images'] = [str(private_image)]
            hosted.runtime.turn_timeout_seconds = 20
            hosted.runtime._process_room(hosted.conversations.bindings()[0])
            task = next(t for t in driver.list_tasks(store.db_path, room_id='c') if t['identity'].turn_id == f't{index}')
            assert task['status'] == 'settled', task
            session = server._sessions[prepared['session_id']]
            envelope = store.prepared_input('c', f'i{index}')
            receipt = session['agent']._session_db.get_conversation_input_receipt(f'i{index}')
            assert receipt.input_digest == envelope.input_digest
            if index == 1:
                assert first_event in envelope.source_event_ids
        requests = [r for r in _MockHandler.captured_requests if r.get('stream') is True and '<conversation_turn_envelope' in json.dumps(r)]
        assert len(requests) == 3
        for request in requests[:2]:
            parts = request['messages'][-1]['content']
            assert isinstance(parts, list), parts
            images = [p for p in parts if p.get('type') == 'image_url']
            assert len(images) == 1
            assert base64.b64decode(images[0]['image_url']['url'].split(',', 1)[1]) == png.getvalue()
            assert 'shared narrative fact' in json.dumps(parts)
        assert requests[0]['messages'][0] == requests[2]['messages'][0]
        event = next(e for e in store.events('c').events if e['event_id'] == first_event)
        assert event['payload']['attachments'] == attachments
        files = list((home / 'conversation-materialized' / 'attachments').iterdir())
        assert {p.read_bytes() for p in files} == {png.getvalue(), b'shared narrative fact'}
        assert not (home / 'profiles' / 'writer' / 'attachments').exists()
    finally:
        http.shutdown()
        thread.join(timeout=3)
        http.server_close()
