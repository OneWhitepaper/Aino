"""Thin, offline-only adapter for unmodified Hermes desktop RPC.

The harness supplies transport, observations and stop conditions. These settings
use Hermes's existing custom-provider configuration and ordinary session API.
They do not add Aino managed authentication to the selected source tree.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit


NATIVE_PROVIDER = "hermes-eval-local"
UPSTREAM_REVISION = "f97608f178d1ffeca59860195ab7da295f7c8e5f"


def verify_native_source(repo: Path, *, object_repo: Path) -> dict:
    """Verify a checkout or git archive against the fixed local upstream tree."""
    result = subprocess.run(
        ["git", "-C", str(object_repo), "ls-tree", "-rz", "--full-tree", UPSTREAM_REVISION],
        capture_output=True, check=False,
    )
    if result.returncode:
        raise ValueError("The fixed upstream Hermes source revision is unavailable in local Git")
    expected = {}
    module_roots = set()
    for row in result.stdout.split(b"\0"):
        if not row:
            continue
        meta, raw_path = row.split(b"\t", 1)
        mode, kind, blob = meta.decode().split()
        name = os.fsdecode(raw_path)
        if kind == "blob":
            expected[name] = (mode, blob)
            if name.endswith(".py"):
                top = name.split("/", 1)[0]
                module_roots.add(top.removesuffix(".py"))
    changed = []
    for name, (mode, blob) in expected.items():
        path = repo / name
        try:
            data = os.fsencode(path.readlink()) if mode == "120000" else path.read_bytes()
        except (OSError, ValueError):
            changed.append(name)
            continue
        # The fixed tree's .gitattributes exports PowerShell as CRLF; Git blobs
        # retain LF. git archive and native checkouts are both valid sources.
        if name.endswith(".ps1"):
            data = data.replace(b"\r\n", b"\n")
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if actual != blob or (mode != "120000" and path.is_symlink()):
            changed.append(name)
    extras = []
    for directory, folders, filenames in os.walk(repo):
        folders[:] = [name for name in folders if name not in
                      (".git", ".venv", "venv", "__pycache__", "node_modules")]
        for filename in filenames:
            path = Path(directory) / filename
            name = str(path.relative_to(repo))
            if (filename.endswith(".py") or filename == ".env") and name not in expected:
                extras.append(name)
    if changed or extras:
        raise ValueError("--repo must contain the unmodified fixed upstream Hermes source; "
                         f"changed/missing={changed[:8]}, additional code/config={extras[:8]}")
    return {
        "source_root": str(repo.resolve()), "source_sha": UPSTREAM_REVISION,
        "source_tree_sha": subprocess.check_output(
            ["git", "-C", str(object_repo), "rev-parse", UPSTREAM_REVISION + "^{tree}"], text=True).strip(),
        "verified_files": len(expected),
        "verification": "every Git blob matches the fixed upstream tree; .ps1 CRLF normalized per its .gitattributes",
        "module_roots": sorted(module_roots - {"evals", "tests"}),
    }


def runtime_source_evidence(source: dict) -> dict:
    """Fail closed if a production import came from outside the verified tree."""
    root = Path(source["source_root"])
    modules = {}
    foreign = {}
    for name, module in tuple(sys.modules.items()):
        if name.split(".", 1)[0] not in source["module_roots"]:
            continue
        origin = getattr(module, "__file__", None)
        if not origin:
            continue
        path = Path(origin).resolve()
        if path.is_relative_to(root):
            modules[name] = str(path.relative_to(root))
        else:
            foreign[name] = str(path)
    if foreign:
        raise ValueError("Native Hermes imported production modules outside its verified source: " + str(foreign))
    return {**source, "production_modules": modules, "production_module_count": len(modules),
            "all_production_modules_from_source": True,
            "managed_modules_loaded": [name for name in sys.modules if name.startswith("tui_gateway.managed_")]}


def configure_profile(config: dict, *, base_url: str, model: str, api_key: str) -> dict:
    """Keep native delegation defaults and bind only a local scripted model."""
    endpoint = urlsplit(base_url)
    if (endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "::1", "localhost")
            or endpoint.username is not None or endpoint.password is not None
            or endpoint.query or endpoint.fragment or endpoint.path.rstrip("/") != "/v1"):
        raise ValueError("Offline Hermes evaluation requires an unambiguous HTTP loopback /v1 endpoint")
    result = deepcopy(config)
    result["model"] = {"default": model, "provider": NATIVE_PROVIDER}
    result["providers"] = {NATIVE_PROVIDER: {
        "api": base_url.rstrip("/"), "transport": "responses",
        "api_key": api_key, "default_model": model,
    }}
    return result


def native_session_params(workspace: Path, *, model: str, reasoning_effort: str) -> dict:
    """Use the model/provider fields accepted by ordinary Hermes session.create."""
    return {
        "source": "desktop", "cwd": str(workspace), "model": model,
        "provider": NATIVE_PROVIDER, "reasoning_effort": reasoning_effort,
        "close_on_disconnect": True, "hidden": True,
        "title": "TEST native Hermes offline evaluation",
    }
