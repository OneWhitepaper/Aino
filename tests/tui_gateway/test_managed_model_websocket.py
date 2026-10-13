"""Two real ASGI websocket transports delegate a live desktop session."""
import json
import threading
import socket

import uvicorn
from websockets.sync.client import connect
from datetime import datetime, timedelta, UTC

from starlette.applications import Starlette
from starlette.routing import WebSocketRoute

from hermes_state_registry import acquire
from tui_gateway import server as gateway_server
from tui_gateway.managed_model_runtime import get_registry
from tui_gateway.ws import handle_ws


def test_actual_websocket_delegation_and_disconnect(tmp_path, monkeypatch, caplog, request):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    # Pin the real shared DB to the directory inspected for leaked credentials,
    # and release its reference before interpreter teardown can run __del__.
    database = acquire(tmp_path / "state.db")
    request.addfinalizer(database.close)
    monkeypatch.setattr(gateway_server, "_db", database)
    main_finished = threading.Event()

    async def endpoint(ws):
        if ws.query_params.get("token") != "local-fixture-token":
            await ws.close(code=1008)
            return
        try:
            await handle_ws(ws, auth_identity={"provider": "fixture", "user_id": "gateway-user"})
        finally:
            if ws.query_params.get("role") == "main":
                main_finished.set()

    app = Starlette(routes=[WebSocketRoute("/api/ws", endpoint)])
    started = threading.Event()
    class TestServer(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets)
            started.set()

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    origin = f"ws://127.0.0.1:{listener.getsockname()[1]}"
    server = TestServer(uvicorn.Config(app, lifespan="off", log_config=None))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    assert started.wait(timeout=5)
    request_id = 0

    def request(ws, method, params):
        nonlocal request_id
        request_id += 1
        ws.send(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}))
        while True:
            for line in ws.recv(timeout=5).splitlines():
                response = json.loads(line)
                if response.get("id") == request_id:
                    assert "error" not in response, response
                    return response["result"]

    secret = "fixture-key-websocket-no-persistence"
    try:
        with connect(origin + "/api/ws?token=local-fixture-token", open_timeout=5, close_timeout=2) as chat:
            ready = json.loads(chat.recv(timeout=5))
            assert ready["params"]["payload"]["managed_model_binding"] == 1
            sid = request(chat, "session.create", {"source": "desktop", "cwd": str(tmp_path), "close_on_disconnect": True})["session_id"]
            owner = {"platform_origin": "https://fixture.invalid", "user_id": "platform-user"}
            params = {"session_id": sid, "model_id": "fixture", "owner": owner}
            ticket = request(chat, "session.managed_model_ticket", params)["session_ticket"]
            with connect(origin + "/api/ws?token=local-fixture-token&role=main", open_timeout=5, close_timeout=2) as main:
                claim = request(main, "session.claim_managed_model", params | {"session_ticket": ticket})
                response = request(main, "session.bind_managed_model", params | {
                    "binding_revision": claim["binding_revision"], "model": "fixture-model",
                    "api_mode": "responses", "capabilities": {"tools": True, "vision": False, "reasoning": True},
                    "api_key": secret, "credential_id": "fixture-lease", "base_url": "https://fixture.invalid/v1",
                    "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                })
                assert response["bound"] is True
                assert get_registry().get(sid).api_key == secret
                assert secret not in json.dumps(response)
                main.send('{"api_key":"' + secret + '"')
                malformed = json.loads(main.recv(timeout=5))
                assert malformed["error"]["code"] == -32700
            assert main_finished.wait(timeout=3)
            assert get_registry().get(sid) is None
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        listener.close()
        assert not thread.is_alive()
    assert secret not in caplog.text
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert secret.encode() not in path.read_bytes()
