"""Only server-authenticated install-owner WebSockets may adopt ownerless legacy history."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


@pytest.mark.parametrize('credential', ['valid', 'missing', 'wrong', 'ungated'])
def test_upgrade_auth_proof_controls_ownerless_adoption(runtime_env, monkeypatch, credential):
    from hermes_state import SessionDB
    from hermes_cli import web_server
    from hermes_cli.web_routers import chat_ws
    from tui_gateway import ws as ws_module
    from tui_gateway.conversation_service import ConversationService
    server,store,_,home,_ = runtime_env
    service = ConversationService(server,db_path=store.db_path)
    monkeypatch.setattr(server,'get_conversation_service',lambda:service)
    monkeypatch.setattr(web_server.app.state,'auth_required',False,raising=False)
    monkeypatch.setattr(web_server.app.state,'bound_host','127.0.0.1',raising=False)
    monkeypatch.setattr(web_server.app.state,'bound_port',8080,raising=False)
    monkeypatch.setattr(chat_ws,'_DASHBOARD_EMBEDDED_CHAT_ENABLED',True)
    for name in ('_ensure_skin_watcher','_start_backend_heartbeat_refresher','_schedule_startup_orphan_sweep'):
        monkeypatch.setattr(server,name,lambda:None)
    monkeypatch.setattr(server,'_WS_ORPHAN_REAP_GRACE_S',0)
    db = SessionDB(home/'profiles'/'writer'/'state.db')
    db.create_session('ownerless','desktop')
    db.append_message('ownerless','user','retained public history')
    params = dict(source_profile='writer',lineage_id='ownerless',conversation_id='adopted',input_id='once')
    class Socket:
        client = SimpleNamespace(host='127.0.0.1',port=12345)
        url = SimpleNamespace(path='/api/ws')
        headers = {'host':'127.0.0.1:8080'}
        query_params = {'token':web_server._SESSION_TOKEN if credential=='valid' else ('bad' if credential=='wrong' else '')}
        accepted = False
        closed_code = None
        frames = []
        sent = False
        async def accept(self,**kwargs): self.accepted=True
        async def close(self,code=None,**kwargs): self.closed_code=code
        async def send_text(self,line):
            self.frames.append(json.loads(line))
            if self.frames[-1].get('id')=='adopt': self.done.set()
        async def receive_text(self):
            if not self.sent:
                self.sent=True
                return json.dumps({'jsonrpc':'2.0','id':'adopt','method':'conversations.adopt','params':params})
            await asyncio.wait_for(self.done.wait(),15)
            raise ws_module._WebSocketDisconnect()
    socket=Socket()
    async def run():
        socket.done=asyncio.Event()
        await (ws_module.handle_ws(socket) if credential=='ungated' else chat_ws.gateway_ws(socket))
    try:
        asyncio.run(run())
        responses=[frame for frame in socket.frames if frame.get('id')=='adopt']
        if credential=='valid':
            assert responses[0]['result']['migration']['status']=='complete',responses
            assert service.store.events('adopted').events[0]['payload']['text']=='retained public history'
        elif credential=='ungated':
            assert 'owner transport' in responses[0]['error']['message']
            assert db.get_session_migration('ownerless') is None
        else:
            assert not socket.accepted and socket.closed_code==4401 and not responses
            assert db.get_session_migration('ownerless') is None
    finally:
        db.close()


def test_missing_arbitrary_and_fanout_peers_cannot_supply_install_authority(runtime_env, monkeypatch):
    from tui_gateway.conversation_migration import adopt_session
    from tui_gateway.conversation_service import ConversationService
    from tui_gateway.transport import bind_transport,reset_transport,FanoutTransport
    server,store,_,_,_=runtime_env
    service=ConversationService(server,db_path=store.db_path)
    monkeypatch.setattr(server,'get_conversation_service',lambda:service)
    for peer in (None,SimpleNamespace(auth_identity=None,install_owner_authority=True),FanoutTransport()):
        token=bind_transport(peer)
        try:
            with pytest.raises((ValueError,RuntimeError),match='owner transport'):
                adopt_session(server,source_profile='writer',lineage_id='missing',conversation_id='new',input_id='once')
        finally:
            reset_transport(token)
