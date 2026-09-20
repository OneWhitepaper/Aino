"""Real install backend heartbeat and descriptor evidence gates new conversation work."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_history import _setup


def _owner_check(runtime_env,monkeypatch,owner_mode):
    from gateway import hosted_rooms
    server,store,_,home,_=runtime_env
    hosted,rpc,call,general=_setup(runtime_env,monkeypatch)
    ready,release=home/'compat-ready',home/'compat-release'
    script='''
import os,pathlib,psutil,sys,time
from hermes_state import SessionDB
from gateway.hosted_room_conversation_compat import backend_capabilities
root=pathlib.Path(sys.argv[1]); mode=sys.argv[2]
fd=os.open(root/'shared-state.db',os.O_RDONLY if mode=='readonly' else os.O_RDWR)
if mode not in ('unknown','readonly'):
    with SessionDB(root/'state.db') as db:
        extra={} if mode in ('legacy','expired-legacy') else {'process_started_at':psutil.Process().create_time()-(60 if mode=='stale' else 0),'capabilities':backend_capabilities()}
        extra['last_heartbeat']=time.time()-7*24*3600 if mode.startswith('expired-') else time.time()
        db.register_backend_heartbeat(backend_id='compat-child',pid=os.getpid(),started_at=time.time(),host=os.uname().nodename,**extra)
(root/'compat-ready').touch()
while not (root/'compat-release').exists():time.sleep(.02)
os.close(fd)
'''
    child=subprocess.Popen([sys.executable,'-c',script,str(home),owner_mode],
                           cwd=Path(__file__).resolve().parents[2],env={**os.environ,'HERMES_STATE_DB_GUARD_BYPASS':'1'})
    try:
        deadline=time.monotonic()+15
        while not ready.exists() and time.monotonic()<deadline:
            threading.Event().wait(.01)
        assert ready.exists()
        # Native access flags can prove a raw read-only descriptor; portable fallback stays conservative.
        allowed=owner_mode in ('current','expired-current') or (owner_mode=='readonly' and sys.platform in ('darwin','linux'))
        caps=call('capabilities')
        assert caps['enabled'] is allowed,caps
        result=rpc('create',conversation_id='next',title='Next',general_participant_id=general)
        if allowed:
            assert 'result' in result,result
        else:
            assert 'error' in result,result
            with pytest.raises(hosted_rooms.RoomNotFoundError):store.get('next')
        assert call('get',conversation_id='c')['conversation']['conversation_id']=='c'
        assert not call('events',conversation_id='c')['events']
    finally:
        release.touch()
        assert child.wait(timeout=15)==0
    assert call('capabilities')['enabled'] is True


@pytest.mark.parametrize('owner_mode',['legacy','current','stale','unknown'])
def test_only_known_current_backend_owners_allow_new_work(runtime_env,monkeypatch,owner_mode):
    _owner_check(runtime_env,monkeypatch,owner_mode)


@pytest.mark.macos_only
def test_readonly_source_does_not_claim_mac_backend_ownership(runtime_env,monkeypatch):
    _owner_check(runtime_env,monkeypatch,'readonly')


@pytest.mark.linux_only
def test_readonly_source_does_not_claim_linux_backend_ownership(runtime_env,monkeypatch):
    _owner_check(runtime_env,monkeypatch,'readonly')


@pytest.mark.parametrize('owner_mode', ['expired-legacy', 'expired-current'])
def test_expired_local_heartbeat_still_checks_live_process(runtime_env, monkeypatch, owner_mode):
    _owner_check(runtime_env, monkeypatch, owner_mode)


@pytest.mark.parametrize('pid', [os.getpid(), 2147483647])
def test_foreign_heartbeat_expires_without_using_local_pid_or_deleting_history(runtime_env, monkeypatch, pid):
    from hermes_state import SessionDB
    _server, store, _install, home, _root = runtime_env
    _hosted, _rpc, call, _general = _setup(runtime_env, monkeypatch)
    with SessionDB(home / 'state.db') as db:
        db.register_backend_heartbeat(
            backend_id='old-host', pid=pid, started_at=time.time()-8*24*3600,
            last_heartbeat=time.time()-7*24*3600, host='previous-network-host')
        assert call('capabilities')['enabled'] is True
        assert any(row['backend_id']=='old-host' for row in db.list_backend_heartbeats())
        db.register_backend_heartbeat(
            backend_id='old-host', pid=pid, started_at=time.time(),
            last_heartbeat=time.time(), host='previous-network-host')
        result = call('capabilities')
        assert result['enabled'] is False
        assert 'local, upgraded' in result['reason']
