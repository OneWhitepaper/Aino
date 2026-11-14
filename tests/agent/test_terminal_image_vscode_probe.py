"""VS Code image-support probe (agent/terminal_image.py::probe_vscode_images) over a real PTY.

The far end of the PTY plays the terminal: it answers the probe the way VS Code's xterm.js was
measured to answer with ``terminal.integrated.enableImages`` on (sixel reply + DA1) and off
(DA1 only), during the drain or after the probe, then types ``hi``. After the probe the child reads its tty and feeds
it to prompt_toolkit's parser with the CLI's input tables, as the prompt would: ``typed`` is what
would land in the user's prompt.
"""

from __future__ import annotations

import os
import select
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

pytestmark = pytest.mark.platforms("posix")

_REPO = str(Path(__file__).resolve().parents[2])
_CHILD = textwrap.dedent("""
    import os, select, sys, termios, tty
    from agent import terminal_image
    from hermes_cli.pt_input_extras import install_ignored_terminal_sequences
    from prompt_toolkit.input.vt100_parser import Vt100Parser
    from prompt_toolkit.keys import Keys
    control = int(os.environ["_PROBE_CONTROL_FD"])
    # Give the separate terminal process scheduling headroom. The drain case
    # synchronizes its boundary instead of racing an 80 ms parent sleep against
    # the production probe's 100 ms combined budget.
    terminal_image._VSCODE_PROBE_TIMEOUT_S = 2
    real_select = select.select
    primary_wait = True
    def phase_select(read, write, error, timeout):
        global primary_wait
        ready = real_select(read, write, error, timeout)
        if primary_wait and os.environ["_PROBE_REPLY_PHASE"] == "drain":
            primary_wait = False
            print("PROBE_DRAIN_READY", flush=True)
            os.read(control, 1)
        return ready
    select.select = phase_select
    result = terminal_image.probe_vscode_images()
    select.select = real_select
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    tty.setcbreak(fd)
    print("PROBE_COMPLETE", flush=True)
    os.read(control, 1)
    os.close(control)
    leaked = b""
    while select.select([fd], [], [], 0.3)[0]:
        leaked += os.read(fd, 256)
    termios.tcsetattr(fd, termios.TCSADRAIN, old)
    install_ignored_terminal_sequences()
    presses = []
    parser = Vt100Parser(presses.append)
    parser.feed(leaked.decode())
    parser.flush()
    typed = "".join(p.data for p in presses if p.key is not Keys.Ignore)
    print("RESULT", result, terminal_image.supports_iterm_images(),
          terminal_image.resolve_inline_mode("auto", overlays=True), "typed=%r" % typed, flush=True)
""")

_ON = b"\x1b[?1;0;4096S\x1b[?62;4;9;22c"
_OFF = b"\x1b[?1;2c"


def _run(reply: bytes, phase: str) -> str:
    import pty

    master, slave = pty.openpty()
    control_read, control_write = os.pipe()
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("SSH_", "KITTY_", "ITERM_", "WEZTERM_", "KONSOLE_", "TMUX"))}
    env.update(TERM_PROGRAM="vscode", TERM="xterm-256color", PYTHONPATH=_REPO,
               _PROBE_CONTROL_FD=str(control_read), _PROBE_REPLY_PHASE=phase)
    proc = subprocess.Popen([sys.executable, "-c", _CHILD], stdin=slave, stdout=slave,
                            stderr=subprocess.PIPE, env=env, cwd=_REPO, pass_fds=(control_read,))
    os.close(slave)
    os.close(control_read)
    out = b""
    answered = False
    typed = False
    try:
        while select.select([master], [], [], 15)[0]:
            try:
                data = os.read(master, 4096)
            except OSError:  # EIO: the child closed its end
                break
            if not data:
                break
            out += data
            reply_ready = (phase == "immediate" and b"\x1b[c" in out) or (
                phase == "drain" and b"PROBE_DRAIN_READY" in out
            )
            if not answered and reply_ready:
                os.write(master, reply)
                if phase == "drain":
                    os.write(control_write, b"r")
                answered = True
            if not typed and b"PROBE_COMPLETE" in out:
                os.write(master, (b"" if answered else reply) + b"hi")
                os.write(control_write, b"k")
                typed = True
    finally:
        os.close(master)
        os.close(control_write)
        proc.wait(timeout=15)
    assert proc.returncode == 0 and proc.stderr is not None, proc.stderr and proc.stderr.read()
    text = out.decode(errors="replace")
    return text[text.index("RESULT"):].splitlines()[0].strip() if "RESULT" in text else text


@pytest.mark.parametrize(
    ("reply", "phase", "expected"),
    [
        (_ON, "immediate", "RESULT True True iterm typed='hi'"),  # enableImages on
        (_OFF, "immediate", "RESULT False False unicode typed='hi'"),  # enableImages off: DA1 only
        (_ON, "drain", "RESULT True True iterm typed='hi'"),
        # Past every wait: the probe misses it, and the prompt's parser drops it.
        (_ON, "late", "RESULT False False unicode typed='hi'"),
        (_OFF, "late", "RESULT False False unicode typed='hi'"),
    ],
)
def test_vscode_probe_reads_its_reply_and_leaves_nothing_for_the_prompt(reply, phase, expected):
    assert _run(reply, phase) == expected
