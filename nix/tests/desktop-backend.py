"""Launch the Nix desktop with a competing mutable install and a local account."""
import contextlib
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

from hermes_cli.desktop_identity import DESKTOP_PRODUCT_NAME

from desktop_account_fixture import _PlatformFixture, _authenticate_fixture


def _processes_under(home: Path) -> list[int]:
    """PIDs whose environment or cwd binds them to this throwaway HOME (Linux /proc)."""
    needle = str(home).encode()
    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit() or int(entry) == os.getpid():
            continue
        try:
            environ = Path("/proc", entry, "environ").read_bytes()
            cwd = os.readlink(f"/proc/{entry}/cwd").encode()
        except OSError:
            continue
        if needle in environ or cwd.startswith(needle):
            found.append(int(entry))
    return found


desktop, expected = sys.argv[1:]
with tempfile.TemporaryDirectory(prefix="hermes-desktop-backend-") as temporary:
    home = Path(temporary)
    hermes_home = home / ".hermes"
    legacy = hermes_home / "hermes-agent"
    (legacy / "hermes_cli").mkdir(parents=True)
    (legacy / "hermes_cli" / "main.py").touch()
    launcher = legacy / "venv" / "bin" / "hermes"
    launcher.parent.mkdir(parents=True)
    # The old runtime passes discovery but cannot initialize a session. It
    # must not win merely because it was installed before the Nix desktop.
    launcher.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if '--version' in sys.argv:\n"
        "    print('Hermes legacy fixture')\n"
        "    sys.exit(0)\n"
        "print('WRONG_BACKEND_SELECTED', flush=True)\n"
        "sys.exit(73)\n"
    )
    launcher.chmod(0o755)
    runtime = home / "runtime"
    runtime.mkdir(mode=0o700)
    user_data = home / "electron"
    user_data.mkdir()
    platform = ThreadingHTTPServer(("127.0.0.1", 0), _PlatformFixture)
    threading.Thread(target=platform.serve_forever, daemon=True).start()
    # Nix ships a directory app loaded by Electron, so the existing native
    # development-origin config applies; the platform auth adapter stays on.
    (user_data / "platform-development.json").write_text(json.dumps({
        "enabled": True, "origin": f"http://127.0.0.1:{platform.server_port}",
    }))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        cdp_port = probe.getsockname()[1]
    env = {
        "PATH": os.environ["PATH"],
        "HOME": str(home),
        "HERMES_HOME": str(hermes_home),
        "HERMES_DESKTOP_USER_DATA_DIR": str(user_data),
        "XDG_RUNTIME_DIR": str(runtime),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "WLR_BACKENDS": "headless",
        "WLR_RENDERER": "pixman",
        "WLR_NO_HARDWARE_CURSORS": "1",
        "FONTCONFIG_FILE": os.environ["FONTCONFIG_FILE"],
        "LANG": "C.UTF-8",
        "TZ": "UTC",
    }
    log_path = home / "desktop-output.log"
    with log_path.open("w") as log:
        child = subprocess.Popen(
            ["cage", "--", desktop, "--no-sandbox", "--disable-gpu", "--ozone-platform=wayland",
             f"--remote-debugging-port={cdp_port}", "--remote-debugging-address=127.0.0.1"],
            cwd=home, env=env, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            _authenticate_fixture(cdp_port, log_path, child)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                output = log_path.read_text()
                for desktop_log in home.rglob("desktop.log"):
                    output += desktop_log.read_text()
                assert "WRONG_BACKEND_SELECTED" not in output, output
                assert child.poll() is None, output
                # Desktop attaches to `hermes gateway ensure` (the daemon serves the dashboard), so
                # readiness is Desktop's own attach line, not a spawned `hermes serve` sentinel.
                if f"[backend] {DESKTOP_PRODUCT_NAME} gateway is ready" in output:
                    assert f"[backend] using existing {DESKTOP_PRODUCT_NAME} CLI at {expected}" in output, output
                    print("PASS: packaged desktop selected its pinned backend over the mutable install")
                    break
                time.sleep(0.1)
            else:
                raise AssertionError(f"Desktop did not start its backend:\n{output}")
        finally:
            platform.shutdown()
            platform.server_close()
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
            # The desktop spawns its backend in its own session (hermes serve outlives a
            # window close on purpose), so killing cage's group leaves that gateway writing
            # under HERMES_HOME while the tempdir is removed. Stop everything still rooted
            # in this home before cleanup; the sandbox has no other processes to confuse.
            survivors = _processes_under(home)
            for pid in survivors:
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.kill(pid, signal.SIGTERM)
            deadline = time.monotonic() + 15
            while survivors and time.monotonic() < deadline:
                time.sleep(0.2)
                survivors = _processes_under(home)
            for pid in survivors:
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.kill(pid, signal.SIGKILL)
