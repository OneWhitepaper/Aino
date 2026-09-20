"""Public history actions retain exact source bytes and use normal runtime admission."""
import base64
import copy
import threading
from http.server import HTTPServer

import pytest
import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_attachments import service_rpc
from tests.tui_gateway.test_conversation_authority import Peer, caller


def _setup(runtime_env, monkeypatch):
    server, store, _, _, _ = runtime_env
    hosted, rpc = service_rpc(server,store,monkeypatch)
    def call(method, **params):
        result = rpc(method,**params)
        assert 'error' not in result, result
        return result['result']
    general = next(r['participant']['participant_id'] for r in hosted.conversations.catalog() if r['participant']['is_general'])
    call('create',conversation_id='c',title='Source',general_participant_id=general)
    return hosted,rpc,call,general


def _raw(store, conversation_id):
    from gateway import hosted_rooms
    with hosted_rooms._transaction(store.db_path) as conn:
        return [tuple(r) for r in conn.execute('SELECT event_id,kind,actor_json,payload_json,created_at FROM hosted_room_events WHERE room_id=? ORDER BY seq',(conversation_id,))]


@pytest.mark.parametrize('indexed_input', [True, False])
def test_branch_edit_and_reaction_metadata_preserve_owned_history(runtime_env,monkeypatch,indexed_input):
    from gateway.hosted_room_conversation_types import TurnSubmission
    server,store,_,_,_ = runtime_env
    hosted,rpc,call,general = _setup(runtime_env,monkeypatch)
    attachment = call('attach',conversation_id='c',filename='note.txt',mime_type='text/plain',data_base64=base64.b64encode(b'owned bytes').decode())['attachment']
    submission = TurnSubmission('t','i',general,'original',(attachment['id'],))
    if indexed_input:
        admission = store.append_input('c',submission)
    else:
        from gateway import hosted_rooms
        from types import SimpleNamespace
        authority = hosted_rooms.room_state(store.db_path,room_id='c',purpose='conversation')
        event = hosted_rooms.append_event(store.db_path,room_id='c',purpose='conversation',
            event_id='imported-input',kind='conversation.input',actor={'kind':'user','id':'user','display_name':'User'},
            payload={'input_id':'i','turn_id':'t','text':'original','attachment_ids':[attachment['id']],
                     'attachments':[attachment],'target_participant_id':general,'target_display_name_at_time':'Aino',
                     'author_display_name_at_time':'User'},
            authority_gateway_id=authority['authority_gateway_id'],authority_epoch=authority['authority_epoch'])
        admission = SimpleNamespace(event_id=event['event_id'])
    original = _raw(store,'c')
    revision = store.get('c').revision
    request = dict(conversation_id='c',source_event_id=admission.event_id,expected_revision=revision,target_conversation_id='b',operation_id='branch')
    branch = call('branch',**request)
    assert call('branch',**request) == branch
    assert _raw(store,'b') == original == _raw(store,'c')
    replay = call('send',conversation_id='b',turn_id='t',input_id='i',participant_id=general,
                  text='original',attachment_ids=[attachment['id']],expected_revision=store.get('b').revision)
    assert replay['admission']['idempotent'] and not hosted.conversations._tasks('b')
    assert all(b.lineage_id is None and b.session_generation == 1 for b in store.participants('b'))
    assert call('events',conversation_id='b')['events'][0]['provenance']['conversation_id'] == 'c'
    retained = call('content',conversation_id='b',content_id=attachment['content_ref']['id'])
    assert base64.b64decode(retained['data_base64']) == b'owned bytes'
    edit = call('branch',**{**request,'target_conversation_id':'e','operation_id':'edit','edit_text':'changed'})['branch']
    assert edit['draft']['participant_id'] == general and edit['draft_pending']
    assert not store.events('e').events
    assert call('get',conversation_id='e')['conversation']['branch'] == edit
    draft = edit['draft']
    assert 'error' in rpc('send',conversation_id='e',expected_revision=store.get('e').revision,
        **{k:v for k,v in draft.items() if k != 'source_event_id'}, command_token='invalid')
    call('prepare',conversation_id='e',participant_id=general)
    sent = call('send',conversation_id='e',expected_revision=store.get('e').revision,
        **{k:v for k,v in draft.items() if k != 'source_event_id'})
    assert sent['admission']['input_id'] == draft['input_id']
    assert not call('get',conversation_id='e')['conversation']['branch']['draft_pending']
    assert store.events('e').events[0]['payload']['history_relation'] == {
        'kind':'edit','conversation_id':'c','event_id':admission.event_id}
    assert 'error' in rpc('branch',**{**request,'edit_text':'changed'})
    assert 'error' in rpc('branch',**{**request,'target_conversation_id':'stale','operation_id':'stale','expected_revision':revision+1})
    reaction = dict(conversation_id='c',event_id=admission.event_id,operation_id='like',emoji='👍',expected_reaction_revision=0)
    first = call('react',**reaction)
    assert call('react',**reaction) == first
    assert call('reactions',conversation_id='b',event_ids=[admission.event_id])['reactions'][0]['reactions'] == []
    assert 'error' in rpc('react',**{**reaction,'operation_id':'stale'})
    cleared = call('react',**{**reaction,'operation_id':'clear','emoji':None,'expected_reaction_revision':1})
    assert cleared['reaction']['revision'] == 2 and not cleared['reaction']['reactions']
    with caller(Peer('stranger')):
        assert 'error' in rpc('branch',**request)
        assert 'error' in rpc('react',**reaction)
    assert _raw(store,'c') == original and store.get('c').revision == revision


@pytest.mark.parametrize('skill_command', [False, True])
def test_regenerate_new_attempt_relation_and_busy_recovery_boundary(runtime_env,monkeypatch,skill_command):
    from tests.agent.test_api_content_sidecar import _MockHandler
    from gateway import hosted_room_driver as driver
    server,store,_,home,_ = runtime_env
    _MockHandler.captured_requests,_MockHandler.response_queue = [],[]
    http = HTTPServer(('127.0.0.1',0),_MockHandler)
    thread = threading.Thread(target=http.serve_forever,daemon=True);thread.start()
    cfg = yaml.safe_load((home/'config.yaml').read_text())
    cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
    cfg['compression'] = {'enabled':False}
    (home/'config.yaml').write_text(yaml.safe_dump(cfg))
    try:
        hosted,rpc,call,general = _setup(runtime_env,monkeypatch)
        call('prepare',conversation_id='c',participant_id=general)
        text, command_token = 'hello', None
        if skill_command:
            skill = home/'skills'/'history-command'/'SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('---\nname: history-command\ndescription: history test\n---\nOLD-PRIVATE-BODY\n')
            command = call('command',conversation_id='c',participant_id=general,expected_generation=1,
                expected_revision=store.get('c').revision,command='/history-command explain')
            text,command_token = command['display'],command['command_token']
        call('send',conversation_id='c',turn_id='t',input_id='i',participant_id=general,text=text,
             command_token=command_token,expected_revision=store.get('c').revision)
        binding = hosted.conversations.bindings()[0]
        hosted.runtime.turn_timeout_seconds=15
        hosted.runtime._process_room(binding);hosted.conversations.prepare_room(binding)
        source = next(e for e in store.events('c').events if e['kind']=='conversation.response')
        original = _raw(store,'c')
        private_history = {sid:copy.deepcopy(session['history']) for sid,session in server._sessions.items()}
        call('branch',conversation_id='c',source_event_id=source['event_id'],
             expected_revision=store.get('c').revision,target_conversation_id='snapshot',operation_id='snapshot')
        assert {sid:session['history'] for sid,session in server._sessions.items()} == private_history
        assert _raw(store,'snapshot') == original
        params = dict(conversation_id='c',source_event_id=source['event_id'],expected_revision=store.get('c').revision,input_id='again',turn_id='again-turn')
        if skill_command:
            skill.write_text(skill.read_text().replace('OLD-PRIVATE-BODY','NEW-PRIVATE-BODY'))
        new = call('regenerate',**params)
        if skill_command:
            assert 'NEW-PRIVATE-BODY' in store.prepared_input('c','again').text
            skill.write_text(skill.read_text().replace('NEW-PRIVATE-BODY','AFTER-ADMISSION-BODY'))
        assert call('regenerate',**params)['admission']['event_id'] == new['admission']['event_id']
        assert 'error' in rpc('regenerate',**{**params,'input_id':'busy','turn_id':'busy','expected_revision':store.get('c').revision})
        assert 'error' in rpc('branch',conversation_id='c',source_event_id=source['event_id'],expected_revision=store.get('c').revision,target_conversation_id='busy',operation_id='busy')
        hosted.runtime._process_room(binding);hosted.conversations.prepare_room(binding)
        events = store.events('c').events
        related = [e for e in events if e['payload'].get('history_relation')]
        assert {e['kind'] for e in related} == {'conversation.input','conversation.response'}
        assert all(e['payload']['history_relation']['event_id']==source['event_id'] for e in related)
        assert _raw(store,'c')[:len(original)] == original
        tasks = driver.list_tasks(store.db_path,room_id='c')
        assert len(tasks)==2 and all(t['status']=='settled' for t in tasks)
        requests = [r for r in _MockHandler.captured_requests if r.get('stream') is True and 'messages' in r]
        assert requests[0]['messages'][0] == requests[1]['messages'][0]
        if skill_command:
            call('branch',conversation_id='snapshot',source_event_id=source['event_id'],
                expected_revision=store.get('snapshot').revision,target_conversation_id='nested',operation_id='nested')
            call('regenerate',conversation_id='nested',source_event_id=source['event_id'],
                expected_revision=store.get('nested').revision,input_id='nested-again',turn_id='nested-turn')
            assert 'AFTER-ADMISSION-BODY' in store.prepared_input('nested','nested-again').text
            from gateway import hosted_rooms
            with hosted_rooms._transaction(store.db_path) as conn:
                assert not conn.execute('SELECT 1 FROM hosted_conversation_command_tokens WHERE conversation_id=? AND consumed_input_id=?',
                                        ('nested','i')).fetchone()
    finally:
        http.shutdown();thread.join(timeout=3);http.server_close()
