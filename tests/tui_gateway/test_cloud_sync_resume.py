"""Cloud imports refresh real resume/next-turn projections without automatic execution."""
import contextlib
import uuid

import pytest

from hermes_state import SessionDB
from tui_gateway import server
from hermes_cli.cloud_sync import dispatch


class _Peer:
    auth_identity = {'provider': 'fixture', 'user_id': 'local-owner', 'read_only': False}

    def write(self, value):
        return True


def _resume(peer, request_id):
    from tui_gateway.transport import bind_transport, reset_transport
    token = bind_transport(peer)
    try:
        return server.handle_request({'id': request_id, 'method': 'session.resume',
                                      'params': {'session_id': 'remote-chat'}})
    finally:
        reset_transport(token)


def _call(home, action, **args):
    return dispatch(dict(version=1, action=action, home=str(home), ui_root=str(home / 'ui'), **args))


def _transfer(source, target, revision):
    prepared = _call(source, 'prepare', request_id=str(uuid.uuid4()))
    op = prepared['exchange']['operations'][0]
    record = dict(key=op['key'], revision=str(revision), payload=op['payload'], deleted=op['deleted'], device_id='a')
    _call(source, 'apply', request_id=prepared['request_id'], response=dict(
        cursor=str(revision), has_more=False, results=[dict(operation_id=op['operation_id'], status='applied', record=record)], changes=[]))
    prepared = _call(target, 'prepare', request_id=str(uuid.uuid4()))
    assert prepared['exchange']['operations'] == []
    return _call(target, 'apply', request_id=prepared['request_id'], response=dict(
        cursor=str(revision), has_more=False, results=[], changes=[record]))


def _bind(monkeypatch, home, db):
    monkeypatch.setattr('hermes_state_registry.acquire', lambda *args, **kwargs: db)
    monkeypatch.setattr(server, '_get_db', lambda: db)
    monkeypatch.setattr(server, '_profile_home', lambda _: home)
    monkeypatch.setattr(server, '_profile_configured_cwd', lambda _: str(home))
    monkeypatch.setattr(server, '_default_session_cwd', lambda: str(home))
    monkeypatch.setattr(server, '_enable_gateway_prompts', lambda: None)
    monkeypatch.setattr(server, '_schedule_session_cap_enforcement', lambda: None)
    monkeypatch.setattr(server, '_schedule_agent_build', lambda *args: None)
    @contextlib.contextmanager
    def session_db(_session):
        yield db
    monkeypatch.setattr(server, '_session_db', session_db)


@pytest.mark.parametrize('managed', [False, True])
def test_real_resume_and_next_turn_replace_warm_history(tmp_path, monkeypatch, managed):
    a, b = tmp_path / 'a', tmp_path / 'b'
    a.mkdir()
    b.mkdir()
    db_a = SessionDB(a / 'state.db')
    model_config = {'model_source': 'aino', 'model_id': 'reasoner', 'model': 'reasoner-model',
                    'api_mode': 'responses', 'platform_owner': {'platform_origin': 'https://example.test', 'user_id': 'u1'},
                    'api_key': 'NEVER-TRANSFER'} if managed else None
    db_a.create_session('remote-chat', 'desktop', model_config=model_config)
    db_a.append_message('remote-chat', 'user', 'original')
    db_a.append_message('remote-chat', 'assistant', 'reply')
    _transfer(a, b, 1)
    db_b = SessionDB(b / 'state.db')
    _bind(monkeypatch, b, db_b)
    from tui_gateway.turn_marker import read_turn_marker
    assert read_turn_marker(b, 'remote-chat') is None
    peer = _Peer()
    result = _resume(peer, 'open')
    assert 'error' not in result, result
    sid = result['result']['session_id']
    session = server._sessions[sid]
    if managed:
        assert result['result']['info']['model_status'] == 'awaiting_managed_credentials'
        assert session['managed_model_params']['api_mode'] == 'responses'
        assert 'api_key' not in session['managed_model_params']
    assert not session.get('running') and not session.get('_auto_continue_scheduled')
    try:
        db_a._execute_write(lambda c: c.execute("UPDATE messages SET content='edited on A' WHERE role='user'"))
        _transfer(a, b, 2)
        result = _resume(peer, 'reopen')
        assert 'error' not in result, result
        assert [m['content'] for m in session['history']] == ['edited on A', 'reply']
        db_a.append_message('remote-chat', 'user', 'remote followup')
        db_a.append_message('remote-chat', 'assistant', 'remote answer')
        _transfer(a, b, 3)
        own = db_b.append_message('remote-chat', 'user', 'local next turn')
        session['_submit_user_row'] = {'_row_id': own}
        server._adopt_out_of_band_turns(session)
        assert [m['content'] for m in session['history']] == [
            'edited on A', 'reply', 'remote followup', 'remote answer']
        assert not session.get('_auto_continue_scheduled')
    finally:
        server._sessions.pop(sid, None)
        db_a.close()
        db_b.close()
