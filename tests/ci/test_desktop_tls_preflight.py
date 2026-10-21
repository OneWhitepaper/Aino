"""Native smoke rejects a broken TLS fixture before downloading an installer."""
import json
import os
import shutil
import subprocess

import pytest

from tests.ci.test_desktop_bundle_smoke import smoke_workflow


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("reject", [False, True])
def test_tls_preflight_preserves_public_proof_and_rejects_invalid_chain(tmp_path, reject):
    step = next(step for job in smoke_workflow()["jobs"].values()
                for step in job.get("steps", [])
                if step.get("name") == "Audit native TLS fixture before downloading the application")
    openssl = shutil.which("openssl")
    assert openssl
    tools = tmp_path / "tools"
    tools.mkdir()
    wrapper = tools / "openssl"
    # Keep real key/certificate generation; fault only the verification process.
    wrapper.write_text('#!/bin/sh\n'
                       'if [ "$1" = verify ] && [ "$REJECT_FIXTURE" = 1 ]; then\n'
                       '  echo "injected chain verification failure" >&2; exit 1\n'
                       'fi\nexec "$REAL_OPENSSL" "$@"\n')
    wrapper.chmod(0o755)
    env = {**os.environ, "SMOKE_ROOT": str(tmp_path / "smoke"),
           "PATH": str(tools) + os.pathsep + os.environ["PATH"],
           "REAL_OPENSSL": openssl, "REJECT_FIXTURE": str(int(reject))}
    result = subprocess.run(["bash", "-e", "-c", step["run"]], env=env,
                            capture_output=True, text=True, timeout=30, check=False)
    assert (result.returncode != 0) == reject, result.stdout + result.stderr
    proof = json.loads((tmp_path / "smoke/out/tls-preflight.json").read_text())
    assert proof["verify"]["status"] == int(reject)
    assert set(proof["certificates"]) == {"ca.pem", "leaf.pem"}
    assert all("PRIVATE KEY" not in cert for cert in proof["certificates"].values())
