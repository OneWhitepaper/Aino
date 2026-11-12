"""Installed runtime identity and offline help must survive without desktop sources."""

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_built_runtime_contains_shared_brand_and_readable_offline_help(tmp_path):
    output = tmp_path / "installed"
    result = subprocess.run(
        [sys.executable, "setup.py", "build_py", "--build-lib", str(output)],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    brand = json.loads((ROOT / "apps/desktop/brand.json").read_text(encoding="utf-8"))
    packaged = output / "hermes_cli/data/brand.json"
    assert packaged.is_file(), "runtime build omitted the shared brand resource"
    assert json.loads(packaged.read_text(encoding="utf-8")) == brand
    source_docs = ROOT / "docs" / "aino"
    installed_docs = output / "hermes_cli" / "data" / "aino-docs"
    assert {path.relative_to(source_docs) for path in source_docs.rglob("*") if path.is_file()} == {
        path.relative_to(installed_docs) for path in installed_docs.rglob("*") if path.is_file()
    }
    probe = subprocess.run(
        [sys.executable, "-I", "-S", "-c", "\n".join([
            "import json, sys",
            "sys.path.insert(0, sys.argv[1])",
            "from hermes_cli import product_identity as p, desktop_identity as d",
            "assert d.DESKTOP_PRODUCT_NAME == p.PRODUCT_NAME",
            "assert d.DESKTOP_APP_ID == p.APP_ID",
            "index = (p.LOCAL_DOCUMENTATION_PATH / 'README.md').read_text(encoding='utf-8')",
            "assert p.PRODUCT_NAME in index",
            "manual = (p.LOCAL_DOCUMENTATION_PATH / 'handbook' / 'README.md').read_text(encoding='utf-8')",
            "assert p.PRODUCT_NAME in manual",
            "assert (p.LOCAL_DOCUMENTATION_PATH / 'handbook' / 'templates' / 'plugin.js').is_file()",
            "assert (p.LOCAL_DOCUMENTATION_PATH / 'handbook' / 'templates' / 'skin.yaml').is_file()",
            "assert (p.LOCAL_DOCUMENTATION_PATH / 'handbook' / 'templates' / 'clock.mjs').is_file()",
            "print(json.dumps([p.PRODUCT_NAME, p.CREATOR_NAME, p.DOCUMENTATION_URL]))",
        ]), str(output)],
        cwd=tmp_path, capture_output=True, text=True, check=False,
    )
    assert probe.returncode == 0, probe.stdout + probe.stderr
    assert json.loads(probe.stdout) == [
        brand["productName"], brand["creatorName"], brand["documentationUrl"],
    ]
