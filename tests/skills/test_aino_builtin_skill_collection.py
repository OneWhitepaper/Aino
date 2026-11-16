"""Aino's curated built-ins use the existing packaged, profile-scoped skill runtime."""

from __future__ import annotations

import json
import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path

import pytest

from agent import skill_commands, skill_utils
from hermes_constants import reset_hermes_home_override, set_hermes_home_override
from scripts.bundles.payload import INERT_SNAPSHOT_DIRS, snapshot
from tools import skills_sync, skills_tool


BUNDLED_SKILLS = Path(__file__).resolve().parents[2] / "skills"


@pytest.fixture
def collection():
    catalog = json.loads((BUNDLED_SKILLS / "aino-builtin-catalog.json").read_text(encoding="utf-8"))
    entries = catalog["skills"]
    assert entries
    assert len({entry["source"] for entry in entries}) == len(entries)
    assert len({entry["name"] for entry in entries}) == len(entries)
    assert len({entry["path"] for entry in entries}) == len(entries)
    return entries


@pytest.fixture(autouse=True)
def isolated_discovery(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "launch-profile"))
    monkeypatch.delenv("HERMES_BUNDLED_SKILLS", raising=False)
    monkeypatch.setattr(skill_utils, "get_external_skills_dirs", list)
    skills_tool.clear_skills_cache()
    yield
    skills_tool.clear_skills_cache()
    skill_utils._external_dirs_cache_clear()


@contextmanager
def profile_scope(home):
    token = set_hermes_home_override(home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _skill_files(root):
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file() and not skills_sync._is_runtime_cache(path, root)
    }


def _offered(entry, root):
    frontmatter, _body = skill_utils.parse_frontmatter(
        (root / entry["path"] / "SKILL.md").read_text(encoding="utf-8")
    )
    return (
        skill_utils.skill_matches_platform(frontmatter)
        and skill_utils.skill_matches_environment(frontmatter)
        and skill_utils.skill_matches_apps(frontmatter)
    )


def test_packaged_collection_seeds_lists_loads_and_exposes_slash_commands(tmp_path, monkeypatch, collection):
    """Release snapshots must retain complete skill packages, usable without the checkout."""
    repo = tmp_path / "release-source"
    shutil.copytree(BUNDLED_SKILLS, repo / "skills", ignore=skills_sync._ignore_runtime_cache)
    for args in (
        ["init", "-q"],
        ["add", "skills"],
        ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "skills"],
    ):
        subprocess.run(
            ["git", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", *args],
            cwd=repo, capture_output=True, check=True,
        )
    payload = tmp_path / "sealed-payload"
    snapshot(repo, "HEAD", payload, exclude=INERT_SNAPSHOT_DIRS)
    packaged = payload / "skills"
    monkeypatch.setattr(skills_sync, "_get_bundled_dir", lambda: packaged)
    home = tmp_path / "new-user"

    with profile_scope(home):
        skills_sync.sync_skills(quiet=True)
        listing = json.loads(skills_tool.skills_list())
        assert listing["success"] is True
        listed = {skill["name"] for skill in listing["skills"]}
        commands = skill_commands.get_skill_commands()
        for entry in collection:
            name = entry["name"]
            source = packaged / entry["path"]
            installed = home / "skills" / entry["path"]
            assert _skill_files(installed) == _skill_files(source), name
            assert _skill_files(source) == _skill_files(BUNDLED_SKILLS / entry["path"]), name
            view = json.loads(skills_tool.skill_view(name, preprocess=False))
            metadata, _body = skill_utils.parse_frontmatter((source / "SKILL.md").read_text(encoding="utf-8"))
            if not skill_utils.skill_matches_platform(metadata):
                assert view["success"] is False, name
                assert view["readiness_status"] == "unsupported", name
                assert name not in listed, name
                continue
            assert view["success"] is True, (name, view)
            assert Path(view["skill_dir"]) == installed, name
            assert view["content"] == (source / "SKILL.md").read_text(encoding="utf-8"), name
            for group in (view["linked_files"] or {}).values():
                for relative in group:
                    linked = json.loads(skills_tool.skill_view(name, file_path=relative, preprocess=False))
                    assert linked["success"] is True, (name, relative, linked)
            if _offered(entry, packaged):
                assert name in listed, name
                command = commands.get("/" + skill_commands.slugify_skill_name(name))
                assert command is not None, name
                assert command["name"] == name, name
                assert Path(command["skill_dir"]) == installed, name


def test_collection_sync_preserves_user_choices_and_isolates_bot_profiles(tmp_path, collection):
    """Updating a Bot's built-ins cannot undo edits/deletions/disablement or leak to another Bot."""
    candidates = [entry for entry in collection if _offered(entry, BUNDLED_SKILLS)]
    edited, deleted, disabled = candidates[:3]
    assert len(candidates) >= 3
    first = tmp_path / "profiles" / "first-bot"
    second = tmp_path / "profiles" / "second-bot"

    with profile_scope(first):
        skills_sync.sync_skills(quiet=True)
        edited_md = first / "skills" / edited["path"] / "SKILL.md"
        custom_content = edited_md.read_text(encoding="utf-8") + "\nOwner-specific instructions.\n"
        edited_md.write_text(custom_content, encoding="utf-8")
        shutil.rmtree(first / "skills" / deleted["path"])
        (first / "config.yaml").write_text(
            f"skills:\n  disabled:\n    - {disabled['name']}\n", encoding="utf-8",
        )
        skills_sync.sync_skills(quiet=True)
        assert edited_md.read_text(encoding="utf-8") == custom_content
        assert not (first / "skills" / deleted["path"]).exists()
        listed = {skill["name"] for skill in json.loads(skills_tool.skills_list())["skills"]}
        assert disabled["name"] not in listed
        assert deleted["name"] not in listed
        assert json.loads(skills_tool.skill_view(disabled["name"], preprocess=False))["success"] is False
        first_commands = skill_commands.get_skill_commands()
        assert "/" + skill_commands.slugify_skill_name(disabled["name"]) not in first_commands

    with profile_scope(second):
        skills_sync.sync_skills(quiet=True)
        listed = {skill["name"] for skill in json.loads(skills_tool.skills_list())["skills"]}
        assert {edited["name"], deleted["name"], disabled["name"]} <= listed
        assert "Owner-specific instructions." not in json.loads(
            skills_tool.skill_view(edited["name"], preprocess=False)
        )["content"]
        second_commands = skill_commands.get_skill_commands()
        for entry in (edited, deleted, disabled):
            command = second_commands["/" + skill_commands.slugify_skill_name(entry["name"])]
            assert Path(command["skill_dir"]).is_relative_to(second)

    with profile_scope(first):
        view = json.loads(skills_tool.skill_view(edited["name"], preprocess=False))
        assert view["content"] == custom_content
        assert Path(view["skill_dir"]).is_relative_to(first)
        assert json.loads(skills_tool.skill_view(deleted["name"], preprocess=False))["success"] is False
        assert "/" + skill_commands.slugify_skill_name(disabled["name"]) not in skill_commands.get_skill_commands()
