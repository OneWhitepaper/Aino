"""Local platform authentication for the Nix desktop backend smoke check."""
from http.server import BaseHTTPRequestHandler
import json
import threading
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect


class _PlatformFixture(BaseHTTPRequestHandler):
    """Exercise the real native account client without a production account."""

    def log_message(self, *_args):
        return

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == "/api/v1/settings/public":
            self._reply({"desktop_api_version": 1, "phone_code_length": 6, "turnstile_enabled": False,
                         "tencent_captcha_enabled": False, "aliyun_captcha_enabled": False})
        elif route == "/api/v1/user/profile":
            assert self.headers.get("Authorization") == "Bearer nix-fixture-access"
            self._reply({"id": 17, "username": "Nix fixture", "email": "nix@example.test",
                         "phone_bound": True})
        elif route in ("/api/v1/desktop/models", "/api/v1/desktop/devices"):
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
        print(f"Platform fixture: {self.command} {self.path} -> {status}", flush=True)
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


def _desktop_output(log_path):
    return log_path.read_text() + "".join(
        desktop_log.read_text() for desktop_log in log_path.parent.rglob("desktop.log")
    )


def _install_platform_transport(port, fixture_origin, log_path, child):
    """Install the packaged E2E transport seam before the real main entry runs."""
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + 20
    while True:
        assert child.poll() is None, _desktop_output(log_path)
        try:
            with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
                target = json.load(response)[0]
            break
        except URLError:
            assert time.monotonic() < deadline, "Main inspector did not start"
            threading.Event().wait(0.1)

    with connect(target["webSocketDebuggerUrl"], open_timeout=2, proxy=None) as websocket:
        sequence = 0
        scripts = {}
        pauses = []

        def receive():
            message = json.loads(websocket.recv(timeout=15))
            if message.get("method") == "Debugger.scriptParsed":
                scripts[message["params"]["scriptId"]] = message["params"]["url"]
            elif message.get("method") == "Debugger.paused":
                pauses.append(message["params"])
            return message

        def rpc(method, params=None):
            nonlocal sequence
            sequence += 1
            websocket.send(json.dumps({"id": sequence, "method": method, "params": params or {}}))
            while True:
                message = receive()
                if message.get("id") == sequence:
                    assert "error" not in message, message
                    return message.get("result", {})

        rpc("Runtime.enable")
        rpc("Debugger.enable")
        rpc("Runtime.runIfWaitingForDebugger")
        while not pauses:
            receive()
        stop = pauses[0]
        frame = stop["callFrames"][0]
        entry = frame.get("url") or scripts.get(frame["location"]["scriptId"], "")
        assert stop["reason"] == "Break on start", (stop["reason"], entry)
        if not entry.endswith("/electron-main.mjs"):
            # A directory app starts in Electron's default_app bootstrap.
            # Stop again at our bundled entry before any application code runs.
            assert entry.endswith("/default_app.asar/main.js"), entry
            breakpoint = rpc("Debugger.setBreakpointByUrl", {
                "lineNumber": 0, "urlRegex": r"/electron-main\.mjs$",
            })
            pauses.clear()
            rpc("Debugger.resume")
            while not pauses:
                receive()
            stop = pauses[0]
            frame = stop["callFrames"][0]
            entry = frame.get("url") or scripts.get(frame["location"]["scriptId"], "")
            assert breakpoint["breakpointId"] in stop.get("hitBreakpoints", []), stop
        assert entry.endswith("/electron-main.mjs"), entry
        expression = """(() => {
            const { app } = require('electron');
            if (app.isReady()) throw new Error('Fixture transport installed after ready');
            const originalFetch = globalThis.fetch;
            const fixtureOrigin = FIXTURE_ORIGIN;
            globalThis.fetch = function(input, init) {
                const simple = typeof input === 'string' || input instanceof URL;
                const url = new URL(simple ? input : input.url);
                if (url.origin === 'https://api.agentera.com.cn' && url.pathname.startsWith('/api/v1/')) {
                    if (!simple) throw new Error('Unexpected platform Request object');
                    return originalFetch(fixtureOrigin + url.pathname + url.search, init);
                }
                if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
                throw new Error('Nix fixture denied external fetch: ' + url.origin);
            };
            return { installed: true, ready: app.isReady() };
        })()""".replace("FIXTURE_ORIGIN", json.dumps(fixture_origin))
        installed = rpc("Runtime.evaluate", {"expression": expression, "includeCommandLineAPI": True, "returnByValue": True})
        assert "exceptionDetails" not in installed, installed
        assert installed["result"]["value"] == {"installed": True, "ready": False}, installed
        rpc("Debugger.resume")
        rpc("Debugger.disable")
        print(f"PASS: production platform transport installed before {entry}", flush=True)


def _authenticate_fixture(port, log_path, child):
    login_started = False
    # Nix build environments deliberately poison proxy variables. Both CDP
    # transports connect only to this fixture's loopback listener.
    opener = build_opener(ProxyHandler({}))
    last_observation = "No CDP target observed"
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        assert child.poll() is None, _desktop_output(log_path)
        try:
            with opener.open(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
                targets = json.load(response)
            last_observation = f"CDP target types: {[target['type'] for target in targets]}"
            for target in targets:
                if target["type"] != "page" or not target["url"].startswith("file:"):
                    continue
                observed = _evaluate(target, """(async () => ({
                    status: await window.hermesDesktop?.platformAccount.status() ?? null,
                    login: window.__nixFixtureLogin ?? null
                }))()""")
                status = observed["status"]
                phase = status.get("phase") if status else "bridge not loaded"
                mode = status.get("mode") if status else None
                error = status.get("error") if status else None
                last_observation = f"Desktop account phase: {phase}; mode: {mode}; error: {error}; login: {observed['login']}"
                assert not observed["login"] or observed["login"]["phase"] != "failed", f"{last_observation}\n{_desktop_output(log_path)}"
                assert not login_started or not error, f"{last_observation}\n{_desktop_output(log_path)}"
                assert not status or mode == "production", last_observation
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
                _evaluate(target, """window.__nixFixtureLogin = { phase: 'pending' };
                void window.hermesDesktop.platformAccount.loginExisting({
                    email: 'nix@example.test', password: 'inert-fixture-password', remember: false
                }).then(result => { window.__nixFixtureLogin = { phase: result.status }; },
                    error => { window.__nixFixtureLogin = { phase: 'failed', code: error?.code ?? 'unknown' }; }); true""")
        except InvalidStatus as error:
            # Account rehoming retires the signed-out renderer. CDP can still
            # list its target briefly, then reject the WebSocket with HTTP 500.
            # Rediscover on the next bounded iteration, never treat this as
            # authentication success or retry other handshake failures.
            if not login_started or error.response.status_code != 500:
                raise
            last_observation = f"Retired login target: {error}"
        except (URLError, ConnectionClosed, TimeoutError) as error:
            last_observation = f"CDP transport error: {type(error).__name__}: {error}"
        threading.Event().wait(0.1)
    raise AssertionError(f"Desktop account fixture did not become ready ({last_observation}):\n{_desktop_output(log_path)}")
