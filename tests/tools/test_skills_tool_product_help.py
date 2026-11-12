"""Installed product help remains readable when terminal files live on another host."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_cli import product_identity
from tools import skills_sync, skills_tool, terminal_tool
from tools.environments.local import LocalEnvironment
from tools.file_tools import clear_file_ops_cache, read_file_tool


class _RemoteNamespace(LocalEnvironment):
    """Use a real shell with a separate, empty view of the controller's docs directory."""

    uses_host_filesystem = False

    def __init__(self, docs_root, sandbox):
        super().__init__(cwd=str(sandbox), timeout=10, persistent=False)
        self.docs_root = str(docs_root)
        self.remote_docs = str(sandbox / "remote-install" / "aino-docs")
        self.calls = 0

    def execute(self, command, cwd="", **kwargs):
        self.calls += 1
        return super().execute(
            command.replace(self.docs_root, self.remote_docs), cwd=cwd, **kwargs)


@pytest.fixture
def installed_help(tmp_path, monkeypatch):
    home = tmp_path / "account-home"
    home.mkdir()
    (home / ".no-bundled-skills").touch()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_RUNTIME_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("HERMES_BUNDLED_SKILLS", str(Path(__file__).resolve().parents[2] / "skills"))
    monkeypatch.chdir(tmp_path)
    synced = skills_sync.sync_skills(quiet=True)
    assert "hermes-agent" in synced["copied"], synced
    assert any(row["name"] == "hermes-agent" for row in skills_tool.find_all_skills())
    loaded = json.loads(skills_tool.skill_view("hermes-agent", preprocess=False))
    assert loaded["success"], loaded

    docs = tmp_path / "installed-resources" / "aino-docs"
    resources = {
        "README.md": "# Aino offline product help\n",
        "handbook/references/configuration.md": "# Account-scoped configuration reference\n",
        "handbook/templates/plugin.js": "// Offline plugin template fixture\n",
    }
    for relative, content in resources.items():
        target = docs / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    monkeypatch.setattr(product_identity, "LOCAL_DOCUMENTATION_PATH", docs)
    return SimpleNamespace(home=home, docs=docs, resources=resources, skill=Path(loaded["skill_dir"]))


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("relative", [
    "README.md", "handbook/references/configuration.md", "handbook/templates/plugin.js",
])
def test_installed_help_is_readable_independently_of_terminal_backend(
    installed_help, tmp_path, monkeypatch, relative,
):
    env = _RemoteNamespace(installed_help.docs, tmp_path)
    task = "product-help-remote"
    monkeypatch.setitem(
        terminal_tool._active_environments, terminal_tool._resolve_container_task_id(task), env)
    try:
        remote_read = json.loads(read_file_tool(str(installed_help.docs / relative), task_id=task))
        assert remote_read.get("not_found"), remote_read
        remote_calls = env.calls

        result = json.loads(skills_tool.skill_view(
            "hermes-agent", file_path=f"aino-docs/{relative}", task_id=task))

        assert result["success"], result
        assert result["content"] == installed_help.resources[relative]
        assert env.calls == remote_calls, "product help must not execute a command in the terminal"
    finally:
        clear_file_ops_cache()
        env.cleanup()


def _prepare_traversal(_help, outside):
    return "hermes-agent", f"../{outside.name}"


def _prepare_absolute(_help, outside):
    return "hermes-agent", str(outside)


def _prepare_symlink(help, outside):
    link = help.docs / "escaped.md"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"symlinks unavailable in test environment: {exc}")
    return "hermes-agent", "escaped.md"


def _prepare_other_skill(help, _outside):
    other = help.home / "skills" / "other-skill"
    other.mkdir()
    (other / "SKILL.md").write_text(
        "---\nname: other-skill\ndescription: Unrelated skill.\n---\n\nUnrelated.\n",
        encoding="utf-8")
    return "other-skill", "README.md"


def _prepare_disabled(help, _outside):
    (help.home / "config.yaml").write_text(
        "skills:\n  disabled: [hermes-agent]\n", encoding="utf-8")
    return "hermes-agent", "README.md"


def _prepare_unsupported_platform(help, _outside):
    (help.skill / "SKILL.md").write_text(
        "---\nname: hermes-agent\ndescription: Host-incompatible fixture.\n"
        "platforms: [unsupported-platform]\n---\n\nUnavailable here.\n", encoding="utf-8")
    return "hermes-agent", "README.md"


def _prepare_invalid_lookup(_help, _outside):
    return "../hermes-agent", "README.md"


_BOUNDARY_PREPARERS = {
    "traversal": _prepare_traversal,
    "absolute": _prepare_absolute,
    "symlink": _prepare_symlink,
    "other-skill": _prepare_other_skill,
    "disabled": _prepare_disabled,
    "platform": _prepare_unsupported_platform,
    "lookup": _prepare_invalid_lookup,
}


@pytest.mark.parametrize("prepare", _BOUNDARY_PREPARERS.values(), ids=_BOUNDARY_PREPARERS)
def test_product_help_keeps_skill_guards_and_document_root_boundary(
    installed_help, tmp_path, prepare,
):
    outside = tmp_path / "outside.md"
    secret = "This unrelated host file must not be exposed."
    outside.write_text(secret, encoding="utf-8")
    skill_name, relative = prepare(installed_help, outside)

    result = json.loads(skills_tool.skill_view(skill_name, file_path=f"aino-docs/{relative}"))

    assert result["success"] is False, result
    assert "content" not in result, result
    assert secret not in json.dumps(result)


@pytest.mark.parametrize("local_copy", ["directory", "escaping-symlink"])
def test_existing_skill_owned_documentation_is_not_replaced_by_product_help(
    installed_help, tmp_path, local_copy,
):
    owned = installed_help.skill / "aino-docs"
    custom = "Custom help owned by this same-named skill.\n"
    if local_copy == "directory":
        owned.mkdir()
        (owned / "README.md").write_text(custom, encoding="utf-8")
    else:
        external = tmp_path / "unrelated-docs"
        external.mkdir()
        (external / "README.md").write_text(custom, encoding="utf-8")
        try:
            owned.symlink_to(external, target_is_directory=True)
        except (OSError, NotImplementedError) as exc:
            pytest.skip(f"symlinks unavailable in test environment: {exc}")

    result = json.loads(skills_tool.skill_view("hermes-agent", file_path="aino-docs/README.md"))

    if local_copy == "directory":
        assert result["success"], result
        assert result["content"] == custom
    else:
        assert result["success"] is False, result
        assert "content" not in result, result
