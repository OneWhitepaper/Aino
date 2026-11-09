"""The Nix smoke fixture rediscovers the renderer retired by native login."""
from contextlib import contextmanager
from http import HTTPStatus
import json
import threading
from types import SimpleNamespace

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.server import serve

from nix.tests.desktop_account_fixture import _authenticate_fixture


@contextmanager
def _cdp_server(*, retirement_status=HTTPStatus.INTERNAL_SERVER_ERROR, fail_before_login=False,
                replacement_mode="production", replacement_account="17"):
    """A real CDP-shaped endpoint: one stale enumeration, then a replacement page."""
    state = {"logins": 0, "lists_after_login": 0, "rejections": 0, "evaluated": []}

    def request(connection, incoming):
        if incoming.path == "/json/list":
            if state["logins"]:
                state["lists_after_login"] += 1
            name = "replacement" if state["lists_after_login"] > 1 else "retired"
            target = {"type": "page", "url": "file:///desktop/index.html",
                      "webSocketDebuggerUrl": f"ws://127.0.0.1:{port}/devtools/page/{name}"}
            return connection.respond(HTTPStatus.OK, json.dumps([target]))
        if incoming.path.endswith("/retired") and (state["logins"] or fail_before_login):
            state["rejections"] += 1
            return connection.respond(retirement_status, "No such renderer target")
        return None

    def evaluate(websocket):
        query = json.loads(websocket.recv(timeout=5))
        assert query["method"] == "Runtime.evaluate"
        expression = query["params"]["expression"]
        state["evaluated"].append(websocket.request.path)
        if "loginExisting" in expression:
            state["logins"] += 1
            value = True
        elif "getConnection" in expression:
            value = {"phase": "signed_out", "blocked": True}
        else:
            replacement = websocket.request.path.endswith("/replacement")
            value = {"status": {"phase": "signed_in" if replacement else "signed_out",
                                "mode": replacement_mode if replacement else "production",
                                "account": {"id": replacement_account} if replacement else None},
                     "login": None}
        websocket.send(json.dumps({"id": query["id"], "result": {"result": {"value": value}}}))

    with serve(evaluate, "127.0.0.1", 0, process_request=request) as server:
        port = server.socket.getsockname()[1]
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield port, state
        finally:
            server.shutdown()
            worker.join(timeout=5)
            assert not worker.is_alive()


def _authenticate(port, tmp_path):
    log = tmp_path / "desktop-output.log"
    log.write_text("fixture desktop is running\n", encoding="utf-8")
    _authenticate_fixture(port, log, SimpleNamespace(poll=lambda: None))


def test_login_rediscovers_the_page_after_a_stale_target_rejects_its_websocket(tmp_path, capsys):
    with _cdp_server() as (port, state):
        _authenticate(port, tmp_path)
    assert state["logins"] == 1
    assert state["rejections"] == 1
    assert state["lists_after_login"] == 2
    assert state["evaluated"][-1] == "/devtools/page/replacement"
    assert "PASS: signed-out desktop refused backend data before native fixture login" in capsys.readouterr().out


@pytest.mark.parametrize("before_login,status", [(True, HTTPStatus.INTERNAL_SERVER_ERROR),
                                                (False, HTTPStatus.FORBIDDEN)])
def test_other_handshake_failures_remain_failures(tmp_path, before_login, status):
    with _cdp_server(retirement_status=status, fail_before_login=before_login) as (port, state):
        with pytest.raises(InvalidStatus) as refused:
            _authenticate(port, tmp_path)
    assert refused.value.response.status_code == status
    assert state["logins"] == (0 if before_login else 1)
    assert state["rejections"] == 1


@pytest.mark.parametrize("replacement", [{"replacement_mode": "legacy-development"},
                                          {"replacement_account": "another-account"}])
def test_a_replacement_must_still_be_the_production_fixture_account(tmp_path, replacement):
    with _cdp_server(**replacement) as (port, state):
        with pytest.raises(AssertionError):
            _authenticate(port, tmp_path)
    assert state["logins"] == 1
    assert state["rejections"] == 1
    assert state["evaluated"][-1] == "/devtools/page/replacement"
