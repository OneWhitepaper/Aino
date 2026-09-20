"""Migration waits for surviving side work and rejects bad attachment bytes before fencing."""
import base64
import shlex
import sys
import threading
import time
from io import BytesIO

import pytest
from PIL import Image

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_migration import _source
from tui_gateway.conversation_migration import adopt_session


def test_finished_side_body_retains_live_process_and_pending_delivery_ownership(runtime_env, monkeypatch):
    from tools.process_registry import process_registry
    server, _service, db, _ids = _source(runtime_env, monkeypatch)
    home = runtime_env[3]
    session = {'session_key': 'legacy', 'profile_home': str(home / 'profiles' / 'writer'), 'cwd': str(home)}
    released = home / 'server-can-exit'
    processes, done = [], threading.Event()
    program = f'import pathlib,time; p=pathlib.Path({str(released)!r})\nwhile not p.exists(): time.sleep(.02)'
    def body():
        process = process_registry.spawn_local(f'{shlex.quote(sys.executable)} -c {shlex.quote(program)}',
            cwd=str(home), task_id='preview-owned')
        processes.append(process)
        return 'Preview server started'
    server._spawn_side_agent('side', session, 'preview-owned', 'legacy-ui', 'background.complete', body,
                             cleanup=done.set)
    assert done.wait(10)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        row = db._read_one("SELECT * FROM session_migration_activities WHERE activity_id='preview-owned'")
        if row is None or dict(row).get('body_finished'):
            break
        threading.Event().wait(.01)
    else:
        pytest.fail('side body did not finish durable admission')
    assert len(processes) == 1 and processes[0].parent_session_id == 'preview-owned'
    params = dict(source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='side-adopt')
    try:
        with pytest.raises(ValueError, match='background processes'):
            adopt_session(server, **params)
        assert not processes[0].exited
        assert db.get_session_migration('legacy') is None
        # A restarted registry has no in-memory child; the same Profile checkpoint
        # still proves the live effect belongs to this finished side task.
        import tools.process_registry as registry_module
        with monkeypatch.context() as patch:
            patch.setattr(registry_module, 'process_registry', registry_module.ProcessRegistry())
            with pytest.raises(ValueError, match='background processes'):
                adopt_session(server, **params)
    finally:
        released.touch()
        assert processes[0]._completion_event.wait(10)
    # The process exited normally, but its side task still owns a pending delegation delivery.
    db._execute_write(lambda conn: conn.execute("""INSERT INTO async_delegations
        (delegation_id,origin_session,parent_session_id,state,dispatched_at,updated_at,delivery_state,completed_at)
        VALUES ('side-pending','preview-owned','preview-owned','completed',1,1,'pending',2)"""))
    with pytest.raises(ValueError, match='unsettled background'):
        adopt_session(server, **params)
    db._execute_write(lambda conn: conn.execute("UPDATE async_delegations SET delivery_state='delivered'"))
    assert adopt_session(server, **params)['status'] == 'complete'
    from hermes_state_migration import SessionMigratedError
    with pytest.raises(SessionMigratedError):
        db.try_acquire_session_turn_lease('preview-owned', 'late-side-turn')
    db.close()


@pytest.mark.parametrize('kind', ['padding', 'non-image', 'mime', 'size'])
def test_bad_inline_images_do_not_install_a_source_fence(runtime_env, monkeypatch, kind):
    server, service, db, _ids = _source(runtime_env, monkeypatch)
    out = BytesIO()
    Image.new('RGB', (2, 2), 'blue').save(out, format='PNG')
    data, mime = base64.b64encode(out.getvalue()).decode(), 'image/png'
    if kind == 'padding':
        data = 'a'
    elif kind == 'non-image':
        data = base64.b64encode(b'not an image').decode()
    elif kind == 'mime':
        mime = 'image/jpeg'
    else:
        import yaml
        config_path = service.db_path.parent / 'config.yaml'
        config = yaml.safe_load(config_path.read_text())
        config['conversations']['storage'] = {'max_content_bytes': 1}
        config_path.write_text(yaml.safe_dump(config))
    db.append_message('legacy', 'user', [{'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{data}'}}])
    with pytest.raises(ValueError):
        adopt_session(server, source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='bad-image')
    assert db.get_session_migration('legacy') is None
    assert db.try_acquire_session_turn_lease('legacy', 'ordinary')
    db.release_session_turn_lease('legacy', 'ordinary')
    assert db.append_message('legacy', 'user', 'Still independently writable')
    db.close()


@pytest.mark.parametrize('known_owner', [True, False])
def test_denied_owner_inventory_is_not_treated_as_empty(monkeypatch, known_owner):
    import psutil
    from types import SimpleNamespace
    from tui_gateway.conversation_migration import _psutil_source_holders
    def denied():
        raise psutil.AccessDenied(987654)
    process = SimpleNamespace(pid=987654, open_files=denied,
        info={'username': psutil.Process().username() if known_owner else None})
    monkeypatch.setattr(psutil, 'process_iter', lambda attrs: iter([process]))
    with pytest.raises(ValueError, match='same-owner'):
        list(_psutil_source_holders())


def test_live_source_database_writable_handle_refuses_adoption(runtime_env, monkeypatch):
    import os
    import subprocess
    server, _service, db, _ids = _source(runtime_env, monkeypatch)
    ready, release = runtime_env[3] / 'holder-ready', runtime_env[3] / 'holder-release'
    program = """
import pathlib,sqlite3,sys,time
with sqlite3.connect(sys.argv[1]) as conn:
    conn.execute('SELECT COUNT(*) FROM sessions').fetchone()
    pathlib.Path(sys.argv[2]).touch()
    while not pathlib.Path(sys.argv[3]).exists(): time.sleep(.02)
"""
    child = subprocess.Popen([sys.executable, '-c', program, str(db.db_path), str(ready), str(release)],
                             env=dict(os.environ))
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            threading.Event().wait(.01)
        assert ready.exists()
        with pytest.raises(ValueError, match='another process holds'):
            adopt_session(server, source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='holder')
        assert db.get_session_migration('legacy') is None
    finally:
        release.touch()
        assert child.wait(timeout=10) == 0
    assert adopt_session(server, source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='holder')['status'] == 'complete'
    db.close()


def _readonly_header_holder_allows_adoption(runtime_env,monkeypatch):
    import os
    import subprocess
    from pathlib import Path
    server,_service,db,_ids=_source(runtime_env,monkeypatch)
    ready,release=runtime_env[3]/'readonly-ready',runtime_env[3]/'readonly-release'
    program = """
import pathlib,sys,time
from hermes_state_dbfile import _pread_db_header
assert _pread_db_header(pathlib.Path(sys.argv[1]),16)==b'SQLite format 3\\x00'
pathlib.Path(sys.argv[2]).touch()
while not pathlib.Path(sys.argv[3]).exists(): time.sleep(.02)
"""
    child=subprocess.Popen([sys.executable,'-c',program,str(db.db_path),str(ready),str(release)],
        cwd=Path(__file__).resolve().parents[2],env=dict(os.environ))
    try:
        deadline=time.monotonic()+10
        while not ready.exists() and time.monotonic()<deadline:
            threading.Event().wait(.01)
        assert ready.exists()
        result=adopt_session(server,source_profile='writer',lineage_id='legacy',conversation_id='adopted',input_id='readonly')
        assert result['status']=='complete' and child.poll() is None
    finally:
        release.touch()
        assert child.wait(timeout=10)==0
        db.close()


@pytest.mark.macos_only
def test_macos_cached_readonly_header_holder_allows_adoption(runtime_env,monkeypatch):
    _readonly_header_holder_allows_adoption(runtime_env,monkeypatch)


@pytest.mark.linux_only
def test_linux_cached_readonly_header_holder_allows_adoption(runtime_env,monkeypatch):
    _readonly_header_holder_allows_adoption(runtime_env,monkeypatch)
