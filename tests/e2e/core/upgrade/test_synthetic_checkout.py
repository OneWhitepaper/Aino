"""The stale-updater fixture must copy import-time resources, not only Python packages."""

import json
import shutil
import subprocess
import sys

from tests.e2e.core.upgrade.test_fresh_process_entrypoints import WORKTREE, _copy_tree


def test_synthetic_checkout_imports_product_identity(tmp_path):
    source = tmp_path / "source"
    package = source / "hermes_cli"
    package.mkdir(parents=True)
    for name in ("__init__.py", "_startup_fast.py", "product_identity.py"):
        shutil.copy2(WORKTREE / "hermes_cli" / name, package / name)
    desktop = source / "apps/desktop"
    desktop.mkdir(parents=True)
    shutil.copy2(WORKTREE / "apps/desktop/brand.json", desktop / "brand.json")
    expected = json.loads((desktop / "brand.json").read_text(encoding="utf-8-sig"))
    (desktop / "desktop-only.txt").write_text("not a runtime input", encoding="utf-8")

    checkout = tmp_path / "checkout"
    _copy_tree(source, checkout, ["hermes_cli"])
    shutil.rmtree(source)
    probe = subprocess.run(
        [sys.executable, "-I", "-S", "-c",
         "import json, sys; sys.path.insert(0, sys.argv[1]); "
         "from hermes_cli import product_identity as identity; "
         "print(json.dumps({'name': identity.PRODUCT_NAME, 'app_id': identity.APP_ID, "
         "'repository': identity.REPOSITORY_URL, 'module': identity.__file__}))", str(checkout)],
        cwd=tmp_path, text=True, capture_output=True, check=False, timeout=30,
    )
    assert probe.returncode == 0, probe.stdout + probe.stderr
    assert json.loads(probe.stdout) == {
        "name": expected["productName"],
        "app_id": expected["appId"],
        "repository": expected["repositoryUrl"],
        "module": str(checkout / "hermes_cli/product_identity.py"),
    }
    assert not (checkout / "apps/desktop/desktop-only.txt").exists()
