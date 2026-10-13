"""Two admitted principals share one real gateway and managed-model registry."""

import json
import socket
import threading
from contextlib import ExitStack
from datetime import datetime, timedelta, UTC

import pytest
import uvicorn
import hermes_yaml as yaml
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

import tui_gateway.server as srv
from hermes_cli import web_server
from hermes_cli.dashboard_auth.ws_tickets import mint_ticket
from hermes_cli.web_routers.chat_ws import gateway_ws
from tests.tui_gateway.test_managed_model_agent import managed_gateway
from tui_gateway.managed_model_runtime import get_registry


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.sequence = 0
        ready = json.loads(ws.recv(timeout=10))
        assert ready["params"]["type"] == "gateway.ready"

    def call(self, method, **params):
        self.sequence += 1
        self.ws.send(json.dumps({
            "jsonrpc": "2.0", "id": self.sequence, "method": method, "params": params,
        }))
        while True:
            for line in self.ws.recv(timeout=20).splitlines():
                response = json.loads(line)
                if response.get("id") == self.sequence:
                    return response

    def ok(self, method, **params):
        response = self.call(method, **params)
        assert "error" not in response, response
        return response["result"]

    def rejected(self, method, *, code=None, **params):
        response = self.call(method, **params)
        expected = {code} if code else {4403, 4410}
        assert response.get("error", {}).get("code") in expected, response
        return response["error"]


def finish_turn(sid):
    # A cold submit first waits for construction, then hands off to the turn worker.
    for _ in range(2):
        with srv._sessions_lock:
            worker = srv._sessions[sid]["_run_thread"]
        worker.join(timeout=30)
        assert not worker.is_alive(), "loopback model turn did not finish"
    assert not srv._sessions[sid].get("agent_error")
    assert not srv._sessions[sid].get("running")


@pytest.mark.parametrize("owner_boundary", ["different-users", "different-origins"])
def test_shared_backend_preserves_owner_authority(
    managed_gateway, tmp_path, monkeypatch, owner_boundary
):
    rig = managed_gateway
    model_origin = yaml.safe_load((tmp_path / "config.yaml").read_text())[
        "custom_providers"
    ][0]["base_url"][:-3]
    owners = [
        {"platform_origin": model_origin, "user_id": "41"},
        {
            "platform_origin": (
                model_origin
                if owner_boundary == "different-users"
                else model_origin.replace("127.0.0.1", "localhost")
            ),
            "user_id": "42" if owner_boundary == "different-users" else "41",
        },
    ]
    monkeypatch.setattr(web_server.app.state, "auth_required", True, raising=False)
    monkeypatch.setattr(web_server.app.state, "bound_host", "127.0.0.1", raising=False)
    monkeypatch.setattr(web_server, "_DASHBOARD_EMBEDDED_CHAT_ENABLED", True)
    started = threading.Event()

    class Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets)
            started.set()

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    url = f"ws://127.0.0.1:{listener.getsockname()[1]}/api/ws"
    server = Server(uvicorn.Config(
        Starlette(routes=[WebSocketRoute("/api/ws", gateway_ws)]),
        lifespan="off", log_config=None,
    ))
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [listener]}, daemon=True
    )
    thread.start()
    assert started.wait(timeout=10)
    try:
        with ExitStack() as sockets:

            def admit(user):
                ticket = mint_ticket(user_id=user, provider="fixture")
                ws = sockets.enter_context(connect(
                    url + "?ticket=" + ticket, open_timeout=10, close_timeout=2,
                ))
                client = Client(ws)
                # Admission consumes the genuine server-owned ticket exactly once.
                with pytest.raises(InvalidStatus):
                    connect(url + "?ticket=" + ticket, open_timeout=5)
                return client

            chats = [admit("gateway-a"), admit("gateway-b")]
            controllers = [admit("gateway-a"), admit("gateway-b")]
            selections, bindings = [], []
            for i, chat in enumerate(chats):
                sid = chat.ok(
                    "session.create", source="desktop", cwd=str(tmp_path),
                    model_source="aino", model_id="fixture-a",
                )["session_id"]
                rig.sessions.append(sid)
                selection = {
                    "session_id": sid, "owner": owners[i], "model_id": "fixture-a",
                }
                selections.append(selection)
                ticket = chat.ok("session.managed_model_ticket", **selection)["session_ticket"]
                chats[1 - i].rejected("session.managed_model_ticket", **selection)
                controllers[1 - i].rejected(
                    "session.claim_managed_model", **selection, session_ticket=ticket,
                )
                revision = controllers[i].ok(
                    "session.claim_managed_model", **selection, session_ticket=ticket,
                )["binding_revision"]
                binding = selection | {
                    "binding_revision": revision,
                    "api_key": f"fixture-shared-secret-{i}",
                    "credential_id": f"fixture-lease-{i}",
                    "base_url": owners[i]["platform_origin"] + "/v1",
                    "model": "fixture-upstream",
                    "api_mode": "chat_completions",
                    "capabilities": {
                        "tools": True, "vision": False, "reasoning": False,
                    },
                    "expires_at": (
                        datetime.now(UTC) + timedelta(minutes=10)
                    ).isoformat(),
                }
                controllers[i].rejected(
                    "session.bind_managed_model",
                    **(binding | {
                        "owner": owners[1 - i],
                        "base_url": owners[1 - i]["platform_origin"] + "/v1",
                    }),
                )
                controllers[1 - i].rejected("session.bind_managed_model", **binding)
                assert controllers[i].ok("session.bind_managed_model", **binding)["bound"]
                controllers[1 - i].rejected(
                    "session.clear_managed_model", session_id=sid,
                    binding_revision=revision,
                )
                bindings.append(binding)

            for i, selection in enumerate(selections):
                sid = selection["session_id"]
                binding_before = get_registry().get(sid)
                transport_before = srv._sessions[sid]["transport"]
                chats[1 - i].rejected(
                    "prompt.submit", code=4403, session_id=sid,
                    text="foreign-owner-message",
                )
                assert srv._sessions[sid]["transport"] is transport_before
                assert get_registry().get(sid) is binding_before
                chats[1 - i].rejected("session.usage", code=4403, session_id=sid)
                chats[1 - i].rejected(
                    "config.set", code=5001, session_id=sid, key="model", value="fixture-b",
                    model_source="aino",
                )
                for method in ("session.activate", "session.resume"):
                    chats[1 - i].rejected(
                        method, code=4403, session_id=(
                            srv._sessions[sid]["session_key"] if method == "session.resume" else sid
                        ),
                    )
                    assert srv._sessions[sid]["transport"] is transport_before
                    assert get_registry().get(sid) is binding_before
            assert not rig.requests

            # Warm real agents through the owning sockets, including a real read_file roundtrip.
            for i, selection in enumerate(selections):
                sid = selection["session_id"]
                assert chats[i].ok(
                    "prompt.submit", session_id=sid, text=f"owner-{i}-warm",
                )["status"] == "streaming"
                finish_turn(sid)
                usage = chats[i].ok("session.usage", session_id=sid)
                assert usage["calls"] >= 1
                assert usage["total"] == usage["input"] + usage["output"]

            start = len(rig.requests)
            rig.hold.set()
            try:
                for i, selection in enumerate(selections):
                    assert chats[i].ok(
                        "prompt.submit", session_id=selection["session_id"],
                        text=f"owner-{i}-overlap",
                    )["status"] == "streaming"
                with rig.request_condition:
                    assert rig.request_condition.wait_for(
                        lambda: len(rig.requests) >= start + 2, timeout=4,
                    )
                assert all(
                    srv._sessions[s["session_id"]]["running"] for s in selections
                )
            finally:
                rig.release.set()
            for selection in selections:
                finish_turn(selection["session_id"])
            for _, authorization, body in rig.requests:
                i = ["Bearer " + b["api_key"] for b in bindings].index(authorization)
                content = json.dumps(body["messages"])
                assert f"owner-{i}-" in content
                assert f"owner-{1 - i}-" not in content
                assert "foreign-owner-message" not in content

            first, second = selections
            # A second authenticated socket for A can deliberately reattach, but
            # the previous transport-bound lease cannot survive that move.
            chats[0] = admit("gateway-a")
            assert chats[0].ok(
                "session.activate", session_id=first["session_id"],
            )["session_id"] == first["session_id"]
            assert get_registry().get(first["session_id"]) is None

            def rebind_first():
                ticket = chats[0].ok("session.managed_model_ticket", **first)["session_ticket"]
                revision = controllers[0].ok(
                    "session.claim_managed_model", **first, session_ticket=ticket,
                )["binding_revision"]
                bindings[0]["binding_revision"] = revision
                assert controllers[0].ok("session.bind_managed_model", **bindings[0])["bound"]

            rebind_first()
            assert chats[0].ok(
                "prompt.submit", session_id=first["session_id"], text="owner-0-reconnected",
            )["status"] == "streaming"
            finish_turn(first["session_id"])
            assert controllers[0].ok(
                "session.clear_managed_model", session_id=first["session_id"],
                binding_revision=bindings[0]["binding_revision"],
            )["cleared"]
            chats[0].rejected(
                "prompt.submit", session_id=first["session_id"],
                text="cleared-owner-message",
            )
            assert chats[1].ok(
                "prompt.submit", session_id=second["session_id"],
                text="owner-1-after-owner-0-clear",
            )["status"] == "streaming"
            finish_turn(second["session_id"])
            assert (
                get_registry().get(second["session_id"]).api_key
                == bindings[1]["api_key"]
            )
            rebind_first()
            detached = threading.Event()
            registry = get_registry()
            original_detach = registry.detach_transport

            def observe_detach(peer):
                removed = original_detach(peer)
                if any(entry.session is srv._sessions[first["session_id"]] for entry in removed):
                    detached.set()
                return removed

            monkeypatch.setattr(registry, "detach_transport", observe_detach)
            controllers[0].ws.close()
            assert detached.wait(timeout=5)
            assert registry.get(first["session_id"]) is None
            assert chats[1].ok(
                "prompt.submit", session_id=second["session_id"],
                text="owner-1-after-owner-0-disconnect",
            )["status"] == "streaming"
            finish_turn(second["session_id"])
            assert registry.get(second["session_id"]).api_key == bindings[1]["api_key"]
            assert rig.requests[-1][1] == "Bearer " + bindings[1]["api_key"]

    finally:
        rig.release.set()
        server.should_exit = True
        thread.join(timeout=10)
        listener.close()
        assert not thread.is_alive()
