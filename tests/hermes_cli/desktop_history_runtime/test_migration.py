"""Selected Code history keeps its native thread and isolated work files on recovery."""

import copy
import json
import os
from pathlib import Path

import pytest


THREAD = "019ab123-4567-7890-abcd-0123456789ab"
FOREIGN = "019ab123-4567-7890-abcd-0123456789ac"


def migrate(source, target, sessions):
    from hermes_cli.desktop_history_runtime import migrate_code_files

    return migrate_code_files(source, target, sessions)


def row(sid="chat-one", thread=THREAD, cwd="", **config):
    return {"id": sid, "cwd": str(cwd), "model_config": {"codex_thread_id": thread, **config},
            "messages": [{"role": "user", "content": "Keep the original conversation"}]}


def rollout(home, thread=THREAD, *, archive=False, cwd="/external/project", records=None):
    root = home / "code" / ("archived_sessions" if archive else "sessions/2026/11/23")
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"rollout-2026-11-23T10-00-00-{thread}.jsonl"
    records = records if records is not None else [
        {"timestamp": "2026-11-23T10:00:00Z", "type": "session_meta", "payload": {
            "id": thread, "timestamp": "2026-11-23T10:00:00Z", "cwd": str(cwd), "source": "cli",
            "originator": "codex_cli_rs", "cli_version": "0.167.2", "model_provider": "aino_code"}},
        {"timestamp": "2026-11-23T10:00:01Z", "type": "response_item", "payload": {
            "type": "message", "role": "user", "content": [{"type": "input_text", "text": "remember amber"}]}},
    ]
    path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
    return path


def workfile(home, name, content="work", sid="chat-one"):
    path = home / "code/workspaces" / sid / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


@pytest.mark.parametrize("archive", [False, True])
def test_selected_rollout_survives_without_copying_other_threads_or_code_home(homes, archive):
    source, target = homes
    selected = rollout(source, archive=archive)
    rollout(source, FOREIGN)
    for name in ("auth.json", "config.toml", "state_5.sqlite", "replay.key", "history.jsonl"):
        (source / "code" / name).write_text("other account credential or state")
    original = selected.read_bytes()

    rows, manifest = migrate(source, target, [row()])

    assert (target / "code/sessions/2026/11/23" / selected.name).read_bytes() == original
    assert rows[0]["model_config"]["codex_thread_id"] == THREAD
    assert [path.name for path in (target / "code").rglob("*.jsonl")] == [selected.name]
    assert not (target / "code/auth.json").exists()
    assert not (target / "code/config.toml").exists()
    assert not (target / "code/state_5.sqlite").exists()
    assert manifest["threads"][0]["status"] == "copied"
    assert selected.read_bytes() == original


def test_projectless_workspace_and_structured_paths_are_remapped_without_mutating_rows(homes):
    source, target = homes
    generated = workfile(source, "nested/result.txt", "selected work")
    workfile(source, "foreign.txt", "foreign work", sid="other-chat")
    old_workspace = generated.parent.parent
    native = rollout(source, cwd=old_workspace)
    with native.open("a") as handle:
        handle.write(json.dumps({"type": "turn_context", "payload": {"cwd": str(old_workspace)}}) + "\n")
    sessions = [row(cwd=old_workspace, cwd_explicit=False)]
    sessions[0]["model_config"]["cwd"] = str(old_workspace)
    sessions[0]["git_repo_root"] = str(old_workspace)
    before = copy.deepcopy(sessions)
    origin = native.read_bytes()

    rows, manifest = migrate(source, target, sessions)

    new_workspace = target / "code/workspaces/chat-one"
    assert (new_workspace / "nested/result.txt").read_text() == "selected work"
    assert not (target / "code/workspaces/other-chat").exists()
    assert rows[0]["cwd"] == str(new_workspace)
    assert rows[0]["model_config"]["cwd"] == str(new_workspace)
    assert rows[0]["git_repo_root"] == str(new_workspace)
    records = [json.loads(line) for line in (target / native.relative_to(source)).read_text().splitlines()]
    assert records[0]["payload"]["cwd"] == str(new_workspace)
    assert records[-1]["payload"]["cwd"] == str(new_workspace)
    assert records[0]["payload"]["id"] == THREAD
    assert sessions == before
    assert native.read_bytes() == origin
    assert generated.read_text() == "selected work"
    assert manifest["workspaces"][0]["copied"] == 1


def test_blank_projectless_row_keeps_ui_intent_and_recovers_its_session_directory(homes):
    source, target = homes
    generated = workfile(source, "output.txt")
    native = rollout(source, cwd=generated.parent)
    rows, _manifest = migrate(source, target, [row(cwd="")])
    assert rows[0]["cwd"] == ""
    assert (target / generated.relative_to(source)).read_text() == "work"
    copied = json.loads((target / native.relative_to(source)).read_text().splitlines()[0])
    assert copied["payload"]["cwd"] == str(target / "code/workspaces/chat-one")


def test_external_project_is_kept_in_place(homes, tmp_path):
    source, target = homes
    project = tmp_path / "developer-project"
    project.mkdir()
    (project / "file.txt").write_text("external work")
    native = rollout(source, cwd=project)
    rows, manifest = migrate(source, target, [row(cwd=project)])
    assert rows[0]["cwd"] == str(project)
    assert manifest["workspaces"] == []
    assert not (target / "code/workspaces").exists()
    assert (target / native.relative_to(source)).read_bytes() == native.read_bytes()


@pytest.mark.parametrize("secret", [".env", ".env.local", "auth.json", "config.toml", "credentials.json",
                                         "id_rsa", "private.pem", ".ssh/key", ".aws/credentials", ".codex/auth.json",
                                         ".op.env", "auth/google_oauth.json", ".config/gh/hosts.yml", "auth.json.bak",
                                         "browser-profile/Cookies"])
def test_projectless_copy_excludes_known_secret_files(homes, secret):
    source, target = homes
    generated = workfile(source, "result.txt")
    workfile(source, secret, "do not migrate")
    rollout(source, cwd=generated.parent)
    _rows, manifest = migrate(source, target, [row()])
    assert (target / generated.relative_to(source)).is_file()
    assert not (target / "code/workspaces/chat-one" / secret).exists()
    assert manifest["workspaces"][0]["excluded"] >= 1


def test_retry_preserves_newer_target_rollout_and_work_files(homes):
    source, target = homes
    generated = workfile(source, "result.txt", "legacy")
    native = rollout(source, cwd=generated.parent)
    rows, _manifest = migrate(source, target, [row(cwd=generated.parent)])
    destination = target / generated.relative_to(source)
    destination.write_text("newer account work")
    copied = target / native.relative_to(source)
    with copied.open("a") as handle:
        handle.write(json.dumps({"type": "event_msg", "payload": {"type": "task_complete"}}) + "\n")
    original = copied.read_bytes()
    os.utime(destination, (2_000_000_000, 2_000_000_000))
    rows_again, manifest = migrate(source, target, [row(cwd=generated.parent)])
    assert destination.read_text() == "newer account work"
    assert copied.read_bytes() == original
    assert rows_again == rows
    assert manifest["threads"][0]["status"] == "existing"
    assert manifest["copied_files"] == 0


def test_missing_native_rollout_is_reported_without_discarding_history(homes):
    source, target = homes
    sessions = [row()]
    rows, manifest = migrate(source, target, sessions)
    assert rows == sessions
    assert manifest["threads"] == [{"thread_id": THREAD, "status": "missing", "paths": []}]
    assert not (target / "code").exists()


def test_json_model_config_is_supported_and_keeps_its_representation(homes):
    source, target = homes
    generated = workfile(source, "result.txt")
    rollout(source, cwd=generated.parent)
    session = row(cwd=generated.parent)
    session["model_config"]["cwd"] = str(generated.parent)
    session["model_config"] = json.dumps(session["model_config"])
    rows, _manifest = migrate(source, target, [session])
    assert isinstance(rows[0]["model_config"], str)
    assert json.loads(rows[0]["model_config"])["cwd"] == str(target / "code/workspaces/chat-one")


def test_sessions_without_native_thread_still_recover_their_own_workspace(homes):
    source, target = homes
    generated = workfile(source, "draft.txt")
    session = row(cwd=generated.parent)
    session["model_config"].pop("codex_thread_id")
    rows, manifest = migrate(source, target, [session])
    assert rows[0]["cwd"] == str(target / "code/workspaces/chat-one")
    assert (target / generated.relative_to(source)).read_text() == "work"
    assert manifest["threads"] == []


@pytest.mark.parametrize("order", [(0, 1, 2), (2, 0, 1), (1, 2, 0)])
def test_approved_compression_chain_shares_original_thread_and_root_workspace(homes, order):
    source, target = homes
    generated = workfile(source, "result.txt", sid="root-chat")
    native = rollout(source, cwd=generated.parent)
    root = row(sid="root-chat", cwd="")
    root["model_config"].update(execution_mode="code", cwd=str(generated.parent), cwd_explicit=False)
    child = row(sid="compressed-chat", cwd="")
    child["parent_session_id"] = "root-chat"
    child["model_config"].update(execution_mode="code", cwd=str(generated.parent), cwd_explicit=False)
    child["git_repo_root"] = str(generated.parent)
    grandchild = copy.deepcopy(child)
    grandchild.update(id="compressed-again", parent_session_id="compressed-chat")
    sessions = [root, child, grandchild]

    rows, manifest = migrate(source, target, [sessions[index] for index in order])

    assert [session["cwd"] for session in rows] == ["", "", ""]
    assert [session["model_config"]["codex_thread_id"] for session in rows] == [THREAD, THREAD, THREAD]
    assert [session["model_config"]["cwd"] for session in rows] == [str(target / "code/workspaces/root-chat")] * 3
    child_row = next(session for session in rows if session["id"] == "compressed-chat")
    assert child_row["git_repo_root"] == str(target / "code/workspaces/root-chat")
    assert (target / generated.relative_to(source)).read_text() == "work"
    assert len(manifest["threads"]) == 1
    assert len(manifest["workspaces"]) == 1
    assert manifest["workspaces"][0]["copied"] == 1
    assert len(list((target / "code").rglob(native.name))) == 1


def test_work_mode_rows_are_untouched_even_if_cwd_looks_like_a_foreign_code_workspace(homes):
    source, target = homes
    generated = workfile(source, "foreign.txt", sid="somebody-else")
    rollout(source)
    session = row(cwd=generated.parent, execution_mode="work")
    session["model_config"]["cwd"] = str(generated.parent)
    rows, manifest = migrate(source, target, [session])
    assert rows == [session]
    assert manifest["threads"] == []
    assert manifest["workspaces"] == []
    assert list(target.iterdir()) == []


def test_interrupted_file_publication_leaves_complete_files_for_a_safe_retry(homes, monkeypatch):
    from hermes_cli.desktop_history_runtime import files

    source, target = homes
    generated = workfile(source, "result.txt", "recovered")
    native = rollout(source, cwd=generated.parent)
    original_link = files.os.link

    def fail_rollout_publication(src, dst, **kwargs):
        if str(dst).endswith(".jsonl"):
            raise OSError("interrupted storage write")
        return original_link(src, dst, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(files.os, "link", fail_rollout_publication)
        with pytest.raises(OSError, match="interrupted"):
            migrate(source, target, [row(cwd=generated.parent)])
    assert (target / generated.relative_to(source)).read_text() == "recovered"
    assert not (target / native.relative_to(source)).exists()
    assert not list(target.rglob(".code-recovery-*"))

    _rows, manifest = migrate(source, target, [row(cwd=generated.parent)])
    assert manifest["workspaces"][0]["existing"] == 1
    assert (target / native.relative_to(source)).exists()


def test_existing_target_rollout_is_preserved_even_if_it_retains_original_workspace_metadata(homes):
    source, target = homes
    generated = workfile(source, "result.txt")
    native = rollout(source, cwd=generated.parent)
    destination = target / native.relative_to(source)
    destination.parent.mkdir(parents=True)
    destination.write_bytes(native.read_bytes())
    with destination.open("a") as handle:
        handle.write(json.dumps({"type": "event_msg", "payload": {"type": "task_complete"}}) + "\n")
    original = destination.read_bytes()
    rows, manifest = migrate(source, target, [row(cwd=generated.parent)])
    assert destination.read_bytes() == original
    assert rows[0]["cwd"] == str(target / "code/workspaces/chat-one")
    assert manifest["threads"][0]["status"] == "existing"


@pytest.mark.platforms("posix")
def test_retry_accepts_complete_target_file_after_temporary_link_cleanup_was_interrupted(homes, monkeypatch):
    source, target = homes
    generated = workfile(source, "result.txt")
    native = rollout(source, cwd=generated.parent)
    original_unlink = Path.unlink

    def interrupt_cleanup(path, **kwargs):
        if path.name.startswith(".code-recovery-"):
            raise OSError("interrupted after atomic publish")
        return original_unlink(path, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", interrupt_cleanup)
        with pytest.raises(OSError, match="after atomic publish"):
            migrate(source, target, [row(cwd=generated.parent)])
    assert (target / generated.relative_to(source)).read_text() == "work"

    _rows, manifest = migrate(source, target, [row(cwd=generated.parent)])
    assert manifest["workspaces"][0]["existing"] == 1
    assert (target / native.relative_to(source)).is_file()
