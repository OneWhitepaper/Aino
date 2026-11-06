"""Local platform authentication for the Nix desktop backend smoke check."""
from http.server import BaseHTTPRequestHandler
import json
import threading
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect


class _PlatformFixture(BaseHTTPRequestHandler):
    """Exercise the real native account client without a production account."""

    def log_message(self, *_args):
        return

    def do_GET(self):
        if self.path == "/api/v1/settings/public":
            self._reply({"desktop_api_version": 1, "phone_code_length": 6, "turnstile_enabled": False,
                         "tencent_captcha_enabled": False, "aliyun_captcha_enabled": False})
        elif self.path == "/api/v1/user/profile":
            assert self.headers.get("Authorization") == "Bearer nix-fixture-access"
            self._reply({"id": 17, "username": "Nix fixture", "email": "nix@example.test",
                         "phone_bound": True})
        elif self.path in ("/api/v1/desktop/models", "/api/v1/desktop/devices"):
            self._reply([])
        else:
            self._reply(None, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        if self.path == "/api/v1/auth/login" and body.get("email") == "nix@example.test" and body.get("password") == "inert-fixture-password":
            self._reply({"access_token": "nix-fixture-access", "refresh_token": "nix-fixture-refresh",
                         "expires_in": 3600, "token_type": "Bearer"})
        else:
            self._reply(None, 401)

    def _reply(self, data, status=200):
        body = json.dumps({"code": 0 if status == 200 else "NOT_FOUND", "message": "fixture", "data": data}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _evaluate(target, expression):
    with connect(target["webSocketDebuggerUrl"], open_timeout=2, proxy=None) as websocket:
        websocket.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {
            "expression": expression, "awaitPromise": True, "returnByValue": True,
        }}))
        while True:
            response = json.loads(websocket.recv(timeout=10))
            if response.get("id") == 1:
                assert "error" not in response, response
                result = response["result"]
                assert "exceptionDetails" not in result, result
                return result["result"].get("value")


def _authenticate_fixture(port, log_path, child):
    login_started = False
    # Nix build environments deliberately poison proxy variables. Both CDP
    # transports connect only to this fixture's loopback listener.
    opener = build_opener(ProxyHandler({}))
    last_observation = "No CDP target observed"
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        assert child.poll() is None, log_path.read_text()
        assert "NIX_FIXTURE_LOGIN_FAILED" not in log_path.read_text(), log_path.read_text()
        try:
            with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
                targets = json.load(response)
            last_observation = f"CDP target types: {[target['type'] for target in targets]}"
            for target in targets:
                if target["type"] != "page" or not target["url"].startswith("file:"):
                    continue
                status = _evaluate(target, "window.hermesDesktop?.platformAccount.status() ?? null")
                phase = status.get("phase") if status else "bridge not loaded"
                last_observation = f"Desktop account phase: {phase}; login started: {login_started}"
                if status and status["phase"] == "signed_in":
                    assert login_started and status["account"]["id"] == "17", status
                    print("PASS: signed-out desktop refused backend data before native fixture login")
                    return
                if login_started:
                    continue
                gate = _evaluate(target, """(async () => {
                    if (!window.hermesDesktop?.platformAccount) return null;
                    const status = await window.hermesDesktop.platformAccount.status();
                    if (status.phase !== 'signed_out') return null;
                    try { await window.hermesDesktop.getConnection('default'); }
                    catch (error) { return { phase: status.phase, blocked: String(error).includes('account_workspace_unavailable') }; }
                    return { phase: status.phase, blocked: false };
                })()""")
                if gate is None:
                    continue
                assert gate == {"phase": "signed_out", "blocked": True}, gate
                # Login retires the renderer. Recover a closed CDP connection
                # by accepting only the fixture's signed-in replacement.
                login_started = True
                _evaluate(target, """setTimeout(() => void window.hermesDesktop.platformAccount.loginExisting({
                    email: 'nix@example.test', password: 'inert-fixture-password', remember: false
                }).catch(error => console.error('NIX_FIXTURE_LOGIN_FAILED', error)), 0); true""")
        except (URLError, ConnectionClosed, TimeoutError) as error:
            last_observation = f"CDP transport error: {type(error).__name__}: {error}"
        threading.Event().wait(0.1)
    raise AssertionError(f"Desktop account fixture did not become ready ({last_observation}):\n{log_path.read_text()}")
