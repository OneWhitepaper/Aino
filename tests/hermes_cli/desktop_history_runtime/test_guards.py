"""Recovery refuses confused thread identity, path escapes and unbounded input."""

import json
from pathlib import Path

import pytest

from tests.hermes_cli.desktop_history_runtime.test_migration import (
    FOREIGN, THREAD, migrate, rollout, row, workfile,
)


@pytest.mark.parametrize("extra_meta", [False, True])
def test_foreign_session_meta_never_enters_target(homes, extra_meta):
    source, target = homes
    native = rollout(source)
    records = [json.loads(line) for line in native.read_text().splitlines()]
    foreign = {"type": "session_meta", "payload": {"id": FOREIGN, "cwd": "/foreign/project"}}
    if extra_meta:
        records.append(foreign)
    else:
        records[0] = foreign
    native.write_text("".join(json.dumps(record) + "\n" for record in records))
    with pytest.raises(ValueError, match="session_meta|thread"):
        migrate(source, target, [row()])
    assert not list(target.rglob("*.jsonl"))


@pytest.mark.parametrize("bad", ["not json\n", '{"type":"response_item","payload":{}}\n',
                                  '{"type":"session_meta","payload":[]}\n'])
def test_malformed_or_unidentified_rollout_is_not_published(homes, bad):
    source, target = homes
    native = rollout(source)
    native.write_text(bad)
    with pytest.raises(ValueError):
        migrate(source, target, [row()])
    assert not list(target.rglob("*.jsonl"))


@pytest.mark.parametrize("thread", ["../auth", "garbage", "", 123])
def test_invalid_thread_reference_is_rejected_before_file_work(homes, thread):
    source, target = homes
    with pytest.raises(ValueError, match="thread"):
        migrate(source, target, [row(thread=thread)])
    assert list(target.iterdir()) == []


@pytest.mark.parametrize("sid", ["../foreign", "..", "foreign/child", "foreign\\child"])
def test_session_id_cannot_escape_its_workspace(homes, sid):
    source, target = homes
    with pytest.raises(ValueError, match="session"):
        migrate(source, target, [row(sid=sid)])
    assert list(target.iterdir()) == []


def test_selected_row_cannot_copy_another_sessions_workspace(homes):
    source, target = homes
    foreign = workfile(source, "private.txt", sid="foreign-chat")
    rollout(source, cwd=foreign.parent)
    with pytest.raises(ValueError, match="workspace"):
        migrate(source, target, [row(cwd=foreign.parent)])
    assert not list(target.rglob("private.txt"))


@pytest.mark.parametrize("location", ["source_rollout", "source_parent", "target_parent", "workspace_file",
                                     "workspace_dir", "target_workspace_file", "source_root", "target_root"])
@pytest.mark.platforms("posix")
def test_symlinks_cannot_redirect_reads_or_writes(homes, tmp_path, location):
    source, target = homes
    generated = workfile(source, "result.txt")
    native = rollout(source, cwd=generated.parent)
    outside = tmp_path / "outside"
    outside.mkdir()
    secret = outside / "private.txt"
    secret.write_text("foreign")
    destination = target / generated.relative_to(source)
    mutations = {
        "source_rollout": lambda: _replace_with_link(native, secret),
        "source_parent": lambda: _replace_parent_with_link(native, outside),
        "target_parent": lambda: (target / "code").symlink_to(outside, target_is_directory=True),
        "workspace_file": lambda: _replace_with_link(generated, secret),
        "workspace_dir": lambda: (generated.parent / "linked").symlink_to(outside, target_is_directory=True),
        "target_workspace_file": lambda: _replace_with_link(destination, secret),
        "source_root": lambda: _replace_root_with_link(source, tmp_path / "real-source"),
        "target_root": lambda: _replace_root_with_link(target, tmp_path / "real-target"),
    }
    mutations[location]()
    with pytest.raises(ValueError, match="symlink|path"):
        migrate(source, target, [row(cwd=generated.parent)])
    assert secret.read_text() == "foreign"
    assert sorted(path.name for path in outside.iterdir()) == ["private.txt"]


def _replace_with_link(path, destination):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    path.symlink_to(destination)


def _replace_parent_with_link(path, destination):
    path.unlink()
    path.parent.rmdir()
    path.parent.symlink_to(destination, target_is_directory=True)


def _replace_root_with_link(path, destination):
    path.rename(destination)
    path.symlink_to(destination, target_is_directory=True)


@pytest.mark.parametrize("overlap", ["equal", "target_inside", "source_inside"])
def test_overlapping_homes_are_rejected(homes, overlap):
    source, target = homes
    if overlap == "equal":
        target = source
    elif overlap == "target_inside":
        target = source / "nested"
    else:
        source = target / "nested"
    with pytest.raises(ValueError, match="overlap"):
        migrate(source, target, [row()])


def test_relative_roots_are_rejected(homes):
    _source, target = homes
    with pytest.raises(ValueError, match="absolute"):
        migrate(Path("legacy"), target, [row()])


def test_workspace_dotdot_path_is_not_resolved_into_foreign_data(homes):
    source, target = homes
    foreign = workfile(source, "private.txt", sid="foreign-chat")
    path = source / "code/workspaces/chat-one/../foreign-chat"
    with pytest.raises(ValueError, match="path|workspace"):
        migrate(source, target, [row(cwd=path)])
    assert foreign.read_text() == "work"


def test_target_rollout_collision_with_foreign_meta_is_rejected(homes):
    source, target = homes
    rollout(source)
    native = rollout(target)
    original = native.read_text().replace(THREAD, FOREIGN)
    native.write_text(original)
    with pytest.raises(ValueError, match="session_meta|thread"):
        migrate(source, target, [row()])
    assert native.read_text() == original


def test_huge_rollout_is_refused_before_reading(homes):
    source, target = homes
    native = rollout(source)
    with native.open("ab") as handle:
        handle.truncate(129 * 1024 * 1024)
    with pytest.raises(ValueError, match="limit|large|budget"):
        migrate(source, target, [row()])
    assert not list(target.rglob("*.jsonl"))


def test_huge_work_file_is_refused_before_reading(homes):
    source, target = homes
    generated = workfile(source, "huge.bin")
    with generated.open("ab") as handle:
        handle.truncate(65 * 1024 * 1024)
    with pytest.raises(ValueError, match="limit|large|budget"):
        migrate(source, target, [row(cwd=generated.parent)])
    assert not list(target.rglob("huge.bin"))


def test_empty_selection_does_not_discover_or_copy_source_data(homes):
    source, target = homes
    rollout(source, FOREIGN)
    rows, manifest = migrate(source, target, [])
    assert rows == []
    assert manifest["threads"] == []
    assert manifest["copied_files"] == 0
    assert list(target.iterdir()) == []


def test_shared_uuid_without_an_approved_parent_chain_is_rejected(homes):
    source, target = homes
    rollout(source)
    with pytest.raises(ValueError, match="lineage|thread"):
        migrate(source, target, [row(sid="first"), row(sid="unrelated")])
    assert list(target.iterdir()) == []


def test_unselected_parent_workspace_cannot_be_claimed_by_selected_child(homes):
    source, target = homes
    generated = workfile(source, "private.txt", sid="unselected-parent")
    child = row(sid="selected-child", cwd=generated.parent)
    child["parent_session_id"] = "unselected-parent"
    with pytest.raises(ValueError, match="workspace|lineage"):
        migrate(source, target, [child])
    assert not list(target.rglob("private.txt"))


def test_workspace_reference_cannot_borrow_an_unrelated_approved_root(homes):
    source, target = homes
    generated = workfile(source, "private.txt", sid="unrelated")
    root = row(sid="root")
    child = row(sid="child", cwd=generated.parent)
    child["parent_session_id"] = "root"
    foreign = row(sid="unrelated", thread=FOREIGN)
    with pytest.raises(ValueError, match="workspace|lineage"):
        migrate(source, target, [root, child, foreign])
    assert not list(target.rglob("private.txt"))


def test_cyclic_selected_lineage_is_rejected(homes):
    source, target = homes
    root, child = row(sid="root"), row(sid="child")
    root["parent_session_id"], child["parent_session_id"] = "child", "root"
    with pytest.raises(ValueError, match="cyclic|lineage"):
        migrate(source, target, [root, child])
    assert list(target.iterdir()) == []


def test_total_workspace_byte_budget_is_checked_before_any_publication(homes):
    source, target = homes
    for index in range(9):
        path = workfile(source, f"work-{index}.bin")
        with path.open("ab") as handle:
            handle.truncate(64 * 1024 * 1024)
    with pytest.raises(ValueError, match="budget"):
        migrate(source, target, [row(cwd=source / "code/workspaces/chat-one")])
    assert list(target.iterdir()) == []


def test_excessive_selection_is_rejected_before_scanning(homes):
    source, target = homes
    with pytest.raises(ValueError, match="limit"):
        migrate(source, target, [row(sid=f"chat-{index}") for index in range(1001)])
    assert list(target.iterdir()) == []


def test_workspace_depth_is_bounded(homes):
    source, target = homes
    path = workfile(source, "/".join(["nested"] * 34 + ["result.txt"]))
    with pytest.raises(ValueError, match="depth"):
        migrate(source, target, [row(cwd=source / "code/workspaces/chat-one")])
    assert path.read_text() == "work"
    assert list(target.iterdir()) == []
