"""Old session APIs cannot expose or execute private managed participant runtimes."""
import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env, _conversation  # noqa: F401
from tui_gateway.session_conversation_binding import resolve_conversation_session


def test_legacy_visibility_mutators_preserve_managed_rows_and_ordinary_controls(runtime_env):
    server,store,install,home,_=runtime_env
    binding=_conversation(store,install)
    runtime=resolve_conversation_session(server,binding=binding,project=None,source='desktop')
    session=server._sessions[runtime.runtime_id]
    for session_id in (runtime.runtime_id,runtime.lineage_id):
        result=server._methods['session.set_hidden']('old-client',{
            'session_id':session_id,'profile':'writer','hidden':False})
        assert 'error' in result,result
    with server._session_db(session) as db:
        with pytest.raises(ValueError,match='conversation'):
            db.set_session_pinned(runtime.lineage_id,True)
        row=db.get_session(runtime.lineage_id)
        assert row['hidden'] and not row['pinned']
        assert runtime.lineage_id not in {row['id'] for row in db.list_sessions_rich()}
        db.create_session('ordinary','desktop')
        db.set_session_hidden('ordinary',True)
        db.append_message('ordinary','user','ordinary history remains usable')
        db.set_session_pinned('ordinary',True)
        assert not db.get_session('ordinary')['hidden']
        assert 'ordinary' in {row['id'] for row in db.list_sessions_rich()}
    response=server._methods['prompt.submit']('old-write',{'session_id':runtime.runtime_id,'text':'bypass'})
    assert response['error']['code']==4120
    assert not session['history'] and not store.events('conversation').events


def test_old_api_missing_capability_is_precise_and_legacy_history_still_works(runtime_env,monkeypatch):
    server,_,_,_,_=runtime_env
    monkeypatch.delitem(server._methods,'conversations.capabilities')
    missing=server.handle_request({'jsonrpc':'2.0','id':'caps','method':'conversations.capabilities','params':{}})
    assert missing['error']['code']==-32601
    created=server._methods['session.create']('legacy',{'profile':'default','source':'desktop'})
    assert 'result' in created,created
    sid=created['result']['session_id']
    assert not server._sessions[sid].get('_conversation_binding')
