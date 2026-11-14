"""An inactive Desktop window cannot settle another window's browser request."""
import asyncio
import threading

import pytest

from tests.gateway.test_session_authorities_multiplex import _reserve_homes, _runner
from tests.waiting import async_wait_until


class _Transport:
    def __init__(self):
        self.frames = []

    def write(self, frame):
        self.frames.append(frame)
        return True

    def close(self):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize("all_decline", [False, True])
async def test_browser_request_waits_for_showing_window_or_unanimous_decline(tmp_path, monkeypatch, all_decline):
    from gateway.run_runtime import initialize_gateway_runtime
    from gateway.runtime_ownership import process_ownership
    from gateway.session_authorities import owner_scope
    from gateway.session_controls import AuthorityConnection
    from gateway.session_server_requests import ask_viewer, waiting
    from tui_gateway.server_requests import NOT_SHOWN_CODE, advertise, forget

    root, homes = _reserve_homes(tmp_path, monkeypatch, names=())
    process_ownership.reserve([root])
    connections, worker, runner = [], None, None
    try:
        runner = _runner(root, homes)
        await initialize_gateway_runtime(runner)
        authority = runner.session_authority
        identity = {"user_id": "uid:desktop", "instance_id": authority.instance_id,
                    "profile_id": authority.profile_id, "native_bootstrap": True}
        for _ in range(2):
            transport = _Transport()
            advertise(transport, True)
            connections.append(AuthorityConnection(authority, transport, identity, operator=True))
        showing, background = connections
        with owner_scope(authority):
            created = await showing.dispatch({"id": 1, "method": "session.create", "params": {
                "request_id": "two-windows", "source": "cli", "cwd": str(tmp_path),
                "model": "m", "toolsets": []}})
            session_id = created["result"]["session_id"]
            await background.dispatch({"id": 2, "method": "session.resume", "params": {"session_id": session_id}})

        events, out = authority.sessions[session_id].event_stream, {}
        worker = threading.Thread(target=lambda: out.update(value=ask_viewer(
            events, session_id, "preview.read", {}, timeout=5, replay=False)), daemon=True)
        worker.start()
        await async_wait_until(lambda: all(any(frame.get("method") == "preview.read"
            for frame in connection.transport.frames) for connection in connections),
            timeout=5, what="browser read delivered to both windows")
        rid = next(frame["id"] for frame in showing.transport.frames if frame.get("method") == "preview.read")
        decline = {"jsonrpc": "2.0", "id": rid, "error": {"code": NOT_SHOWN_CODE, "message": "Not shown here"}}

        with owner_scope(authority):
            await background.dispatch(decline)
        assert waiting(events, session_id, "preview.read") and worker.is_alive() and out == {}

        with owner_scope(authority):
            await showing.dispatch(decline if all_decline else {
                "jsonrpc": "2.0", "id": rid, "result": {"value": "MDN search is visible"}})
        await asyncio.to_thread(worker.join, 5)
        assert not worker.is_alive()
        assert out == {"value": "" if all_decline else "MDN search is visible"}
    finally:
        if worker is not None:
            await asyncio.to_thread(worker.join, 6)
        for connection in connections:
            forget(connection.transport)
            with owner_scope(connection.authority):
                await connection.close()
        for authority in getattr(runner, "session_authorities", None) or []:
            authority.db.close()
        process_ownership.release(root)
