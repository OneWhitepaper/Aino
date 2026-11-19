"""Code uses Aino's packaged engine before any unrelated global Codex executable."""

import json
from pathlib import Path

import pytest

from pm import Facts, Lockfile, get_package, paths
from pm.store import current_target, tree_digest
from hermes_cli.codex_runtime_switch import get_configured_codex_binary


def recorded_codex(store):
    target = current_target()
    package = get_package("codex")
    lock = Lockfile(paths.lockfile_path())
    version = lock.version("codex")
    entry = store / package.store_entry(version, target)
    binary = package.binary(entry, target)
    binary.parent.mkdir(parents=True)
    binary.write_text("fixture executable")
    binary.chmod(0o755)
    Facts(store / "facts.json").record("codex", version, entry.name, package.env(entry, target), store,
        target=target, artifacts=[row["sha256"] for row in lock.artifacts("codex", target)], digest=tree_digest(entry))
    return binary


def installed_codex(tmp_path, monkeypatch):
    store = tmp_path / "tools"
    monkeypatch.setattr(paths, "store_root", lambda: store)
    monkeypatch.setattr(paths, "writable_store_root", lambda: store)
    return recorded_codex(store)


def test_packaged_engine_wins_over_path_and_needs_no_user_configuration(tmp_path, monkeypatch):
    binary = installed_codex(tmp_path, monkeypatch)
    monkeypatch.setenv("PATH", "")
    assert get_configured_codex_binary({}) == str(binary)
    assert get_configured_codex_binary({"model": {"codex_bin": ""}}) == str(binary)


def test_explicit_engine_path_remains_authoritative(tmp_path, monkeypatch):
    installed_codex(tmp_path, monkeypatch)
    explicit = str(tmp_path / "Developer Codex" / "codex")
    assert get_configured_codex_binary({"model": {"codex_bin": explicit}}) == explicit


def test_source_checkout_resolves_existing_path_without_installing(tmp_path, monkeypatch):
    store = tmp_path / "absent-store"
    monkeypatch.setattr(paths, "store_root", lambda: store)
    monkeypatch.setattr(paths, "writable_store_root", lambda: store)
    command = tmp_path / ("codex.exe" if current_target().startswith("win32") else "codex")
    command.write_text("fixture executable")
    command.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    assert get_configured_codex_binary({}) == str(command)
    assert not store.exists()
    monkeypatch.setenv("PATH", "")
    assert get_configured_codex_binary({}) == "codex"


@pytest.mark.parametrize("desktop_override", [False, True])
def test_relocated_payload_keeps_one_engine_across_profiles(tmp_path, monkeypatch, desktop_override):
    from agent.runtime_scope import bind_profile_scope
    from hermes_cli.config import load_config_readonly
    from hermes_constants import get_hermes_home

    payload = tmp_path / "build" / "agent-payload"
    (payload / "hermes-agent").mkdir(parents=True)
    binary = recorded_codex(payload / "tools")
    relative_binary = binary.relative_to(payload)
    (payload / "manifest.json").write_text(json.dumps({
        "repo": "hermes-agent", "store": "tools", "venv": "venv",
        "runtime": {"commands": {"hermes": "bin/aino"}},
    }))
    relocated = tmp_path / "Applications" / "Aino.app" / "Contents" / "Resources" / "agent-payload"
    relocated.parent.mkdir(parents=True)
    payload.rename(relocated)
    # Only the executing code's location is supplied; PM resolves the relocated
    # manifest, selected facts and package pin through its production readers.
    monkeypatch.setattr(paths, "repo_root", lambda: relocated / "hermes-agent")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("HERMES_RUNTIME_DIR", raising=False)
    if desktop_override:
        monkeypatch.setenv("HERMES_RUNTIME_DIR", str(relocated / "tools"))

    for profile_name in ("account-one", "account-two"):
        profile = tmp_path / profile_name
        profile.mkdir()
        (profile / "config.yaml").write_text("model:\n  provider: custom\n  default: selected-model\n")
        with bind_profile_scope(profile, hydrate_secrets=False):
            assert get_hermes_home() == profile
            assert get_configured_codex_binary(load_config_readonly()) == str(relocated / relative_binary)
        assert not (profile / "tools").exists()
