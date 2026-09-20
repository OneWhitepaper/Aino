"""Retained history action metadata is metered; cancelling a draft cannot resurrect its send."""
import pytest
import yaml
from types import SimpleNamespace

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_history import _setup, _raw


def test_history_drafts_and_unadmitted_attempts_respect_byte_and_disk_budgets(runtime_env,monkeypatch):
    from gateway import hosted_rooms
    from gateway.hosted_room_conversation_history import ConversationHistoryStore
    from gateway.hosted_room_conversation_types import TurnSubmission
    from gateway.hosted_room_conversation_content import ContentQuotaError
    from gateway.hosted_room_conversation_budget import usage
    server,store,_,home,_=runtime_env
    hosted,rpc,call,general=_setup(runtime_env,monkeypatch)
    admitted=store.append_input('c',TurnSubmission('t','i',general,'original '*1000))
    room=hosted_rooms.room_state(store.db_path,room_id='c',purpose='conversation')
    answer=hosted_rooms.append_event(store.db_path,room_id='c',purpose='conversation',event_id='answer',
        kind='conversation.response',actor={'kind':'participant','id':general,'display_name':'Aino'},
        payload={'text':'answer','status':'settled','input_id':'i','reply_to_event_id':admitted.event_id},
        authority_gateway_id=room['authority_gateway_id'],authority_epoch=room['authority_epoch'])
    cfg=yaml.safe_load((home/'config.yaml').read_text())
    cfg['conversations']['storage']={'max_total_bytes':1024*1024,'max_conversation_bytes':1024*1024,'max_content_bytes':1024*1024}
    (home/'config.yaml').write_text(yaml.safe_dump(cfg))
    args=dict(conversation_id='c',source_event_id=admitted.event_id,expected_revision=store.get('c').revision,
              target_conversation_id='large',operation_id='large',edit_text='X'*(2*1024*1024))
    assert 'error' in rpc('branch',**args)
    # Each serialized copy must fit, even when the raw draft itself fits max_content.
    assert 'error' in rpc('branch',**{**args,'edit_text':'X'*(400*1024)})
    assert 'error' in rpc('get',conversation_id='large')
    from gateway import hosted_room_conversation_content as content_module
    with monkeypatch.context() as patch:
        patch.setattr(content_module.shutil,'disk_usage',lambda _:SimpleNamespace(free=0))
        assert 'error' in rpc('branch',**{**args,'edit_text':'small'})
    call('branch',**{**args,'edit_text':'small'})
    with hosted_rooms._transaction(store.db_path) as conn:
        retained=conn.execute('SELECT bytes FROM hosted_conversation_history_storage WHERE conversation_id=?',('large',)).fetchone()[0]
        baseline=usage(conn)
    assert retained >= len('small'.encode())*3
    cfg['conversations']['storage']['max_total_bytes']=baseline+15000
    (home/'config.yaml').write_text(yaml.safe_dump(cfg))
    history=ConversationHistoryStore(store)
    params=dict(owner_key=hosted.conversations._authorize('c',write=True),conversation_id='c',
                source_event_id=answer['event_id'],expected_revision=store.get('c').revision,input_id='retry1',turn_id='retry1')
    history.regeneration(**params)
    with pytest.raises(ContentQuotaError):
        history.regeneration(**{**params,'input_id':'retry2','turn_id':'retry2'})
    with hosted_rooms._transaction(store.db_path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM hosted_conversation_regenerations').fetchone()[0]==1
    assert not hosted.conversations._tasks('c')


def test_cancel_exact_pending_draft_is_owner_cas_safe_and_fences_delayed_send(runtime_env,monkeypatch):
    from gateway.hosted_room_conversation_types import TurnSubmission
    from tests.tui_gateway.test_conversation_authority import Peer,caller
    _,store,_,_,_=runtime_env
    hosted,rpc,call,general=_setup(runtime_env,monkeypatch)
    first=store.append_input('c',TurnSubmission('first','first',general,'retained prefix'))
    selected=store.append_input('c',TurnSubmission('second','second',general,'edit this'))
    branch=call('branch',conversation_id='c',source_event_id=selected.event_id,expected_revision=store.get('c').revision,
        target_conversation_id='edited',operation_id='edit',edit_text='fixed edit')
    draft=branch['branch']['draft']
    history=_raw(store,'edited')
    assert history[0][0]==first.event_id
    params=dict(conversation_id='edited',input_id=draft['input_id'],operation_id='cancel',expected_revision=store.get('edited').revision)
    with caller(Peer('stranger')):
        assert 'error' in rpc('cancel_draft',**params)
    assert 'error' in rpc('cancel_draft',**{**params,'expected_revision':params['expected_revision']+1})
    result=call('cancel_draft',**params)
    assert call('cancel_draft',**params)==result
    assert result['conversation']['branch']['draft_cancelled'] and not result['conversation']['branch']['draft_pending']
    assert result['conversation']['revision']==params['expected_revision']+1 and _raw(store,'edited')==history
    call('prepare',conversation_id='edited',participant_id=general)
    send=dict(conversation_id='edited',expected_revision=store.get('edited').revision,
              **{key:value for key,value in draft.items() if key!='source_event_id'})
    assert 'error' in rpc('send',**send)
    assert not hosted.conversations._tasks('edited') and _raw(store,'edited')==history
    result=call('send',**{**send,'input_id':'new-draft','turn_id':'new-turn','text':'ordinary new draft'})
    assert result['admission']['input_id']=='new-draft'


def test_edited_command_uses_canonical_prepare_command_send(runtime_env,monkeypatch):
    from gateway.hosted_room_conversation_types import TurnSubmission
    _,store,_,home,_=runtime_env
    _,_,call,general=_setup(runtime_env,monkeypatch)
    item=store.append_input('c',TurnSubmission('t','i',general,'original'))
    skill=home/'skills'/'edit-command'/'SKILL.md';skill.parent.mkdir(parents=True)
    skill.write_text('---\nname: edit-command\ndescription: test\n---\nPrivate body\n')
    branch=call('branch',conversation_id='c',source_event_id=item.event_id,expected_revision=store.get('c').revision,
        target_conversation_id='edit',operation_id='edit',edit_text='/edit-command   explain')
    draft=branch['branch']['draft']
    call('prepare',conversation_id='edit',participant_id=general)
    resolved=call('command',conversation_id='edit',participant_id=general,expected_generation=1,
        expected_revision=store.get('edit').revision,command=draft['text'])
    before = _raw(store,'c')
    result = call('send',conversation_id='edit',input_id=draft['input_id'],turn_id=draft['turn_id'],participant_id=general,
        text=resolved['display'],command_token=resolved['command_token'],attachment_ids=draft['attachment_ids'],
        expected_revision=resolved['conversation_revision'])
    assert result['admission']['input_id']==draft['input_id']
    assert _raw(store,'c')==before
    assert store.events('edit').events[0]['payload']['text']==resolved['display']
    assert call('get',conversation_id='edit')['conversation']['branch']['draft']['text']==draft['text']
