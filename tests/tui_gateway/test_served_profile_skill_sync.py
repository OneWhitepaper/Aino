"""Desktop upgrades seed newly bundled skills when an existing Bot is first served."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from agent import secret_scope, skill_commands, skill_utils
from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from tools import skills_sync, skills_tool
from tui_gateway import launch_profile_policy, server


def _write_skill(bundle, name):
    directory = bundle / "software-development" / name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Test skill {name}.\n---\n\n# {name}\n",
        encoding="utf-8",
    )
    return directory


@pytest.fixture
def existing_bot(tmp_path, monkeypatch):
    root = tmp_path / ".hermes"
    bot = root / "profiles" / "worker"
    bot.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(server, "_hermes_home", root)
    monkeypatch.setattr(server, "_served_profile_homes", set())
    monkeypatch.setattr(server, "_sessions", {})
    monkeypatch.setattr(secret_scope, "_MULTIPLEX_ACTIVE", False)
    monkeypatch.setattr(launch_profile_policy, "_snapshot", None)
    monkeypatch.setattr(skill_utils, "get_external_skills_dirs", list)
    bundle = tmp_path / "bundle"
    monkeypatch.setattr(skills_sync, "_get_bundled_dir", lambda: bundle)
    skills_tool.clear_skills_cache()
    yield root, bot, bundle
    skills_tool.clear_skills_cache()
    skill_utils._external_dirs_cache_clear()


def test_first_served_bot_receives_upgrade_without_reverting_user_skill_choices(existing_bot, monkeypatch):
    root, bot, bundle = existing_bot
    for name in ("edited-skill", "deleted-skill", "disabled-skill"):
        _write_skill(bundle, name)
    token = set_hermes_home_override(bot)
    try:
        skills_sync.sync_skills(quiet=True)
    finally:
        reset_hermes_home_override(token)
    installed = bot / "skills" / "software-development"
    edited = installed / "edited-skill" / "SKILL.md"
    edited.write_text(edited.read_text(encoding="utf-8") + "Owner instructions.\n", encoding="utf-8")
    shutil.rmtree(installed / "deleted-skill")
    (bot / "config.yaml").write_text("skills:\n  disabled: [disabled-skill]\n", encoding="utf-8")
    fresh = _write_skill(bundle, "new-upgrade-skill")
    calls = []
    real_sync = skills_sync.sync_skills

    def record_sync(*args, **kwargs):
        from hermes_constants import get_hermes_home
        from agent.secret_scope import current_secret_scope

        calls.append((get_hermes_home(), current_secret_scope()))
        return real_sync(*args, **kwargs)

    monkeypatch.setattr(skills_sync, "sync_skills", record_sync)
    cached_context = [{"role": "system", "content": "Existing cached prompt."}]
    server._sessions["existing"] = {"profile_home": str(bot), "messages": cached_context}
    assert server._profile_home("worker") == bot
    assert (installed / "new-upgrade-skill" / "SKILL.md").read_bytes() == (fresh / "SKILL.md").read_bytes()
    assert edited.read_text(encoding="utf-8").endswith("Owner instructions.\n")
    assert not (installed / "deleted-skill").exists()
    assert not (root / "skills").exists()
    assert server._sessions["existing"]["messages"] is cached_context
    assert cached_context == [{"role": "system", "content": "Existing cached prompt."}]
    with server._session_profile_runtime_scope({"profile_home": str(bot)}, hydrate_secrets=False):
        listed = {row["name"] for row in json.loads(skills_tool.skills_list())["skills"]}
        assert "new-upgrade-skill" in listed
        assert "disabled-skill" not in listed
        assert "deleted-skill" not in listed
        assert "/new-upgrade-skill" in skill_commands.get_skill_commands()
    assert server._profile_home("worker") == bot
    assert len(calls) == 1
    assert calls[0][0] == bot
    assert calls[0][1] is not None


def test_first_served_bot_respects_explicit_bundled_skill_opt_out(existing_bot):
    _root, bot, bundle = existing_bot
    _write_skill(bundle, "hermes-agent")
    _write_skill(bundle, "new-upgrade-skill")
    (bot / ".no-bundled-skills").touch()

    assert server._profile_home("worker") == bot
    installed = bot / "skills" / "software-development"
    assert (installed / "hermes-agent" / "SKILL.md").is_file()
    assert not (installed / "new-upgrade-skill").exists()
