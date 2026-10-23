"""Payload cache indexes share wheel trees without retaining builder paths."""
from __future__ import annotations

import os
from pathlib import Path
import shutil

import pytest

from scripts.bundles.native import stage_uv_cache
from pm.uv_cache_prune import prune_uv_cache_to_lock


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("absolute", [False, True])
def test_cache_index_stays_shared_after_payload_moves(tmp_path, absolute):
    source = tmp_path / "build-cache"
    archive = source / "archive-v0/bucket"
    archive.mkdir(parents=True)
    (archive / "module.py").write_bytes(b"VALUE = 42\n")
    index = source / "wheels-v6/pypi/probe/1.0-py3-none-any"
    index.parent.mkdir(parents=True)
    target = archive if absolute else Path(os.path.relpath(archive, index.parent))
    index.symlink_to(target, target_is_directory=True)

    staged = tmp_path / "payload/uv-cache"
    stage_uv_cache(source, staged)
    link = staged / index.relative_to(source)
    assert link.is_symlink(), "the cache index must not materialize a second wheel tree"
    assert not link.readlink().is_absolute()
    assert link.resolve() == staged / "archive-v0/bucket"
    assert index.readlink() == target, "staging must not rewrite the builder's cache"

    moved = tmp_path / "installed/uv-cache"
    moved.parent.mkdir()
    staged.rename(moved)
    shutil.rmtree(source)
    installed = moved / index.relative_to(source)
    assert (installed / "module.py").read_bytes() == b"VALUE = 42\n"
    assert (installed / "module.py").samefile(moved / "archive-v0/bucket/module.py")
    assert sum(path.stat().st_size for path in moved.rglob("*") if path.is_file()) == 11


@pytest.mark.platforms("posix")
def test_cache_link_cannot_depend_on_an_external_build_directory(tmp_path):
    source = tmp_path / "build-cache"
    source.mkdir()
    external = tmp_path / "external-wheel"
    external.mkdir()
    (external / "module.py").write_bytes(b"VALUE = 42\n")
    (source / "index").symlink_to(external, target_is_directory=True)

    with pytest.raises(ValueError, match="cache.*escapes"):
        stage_uv_cache(source, tmp_path / "payload-cache")
    assert (external / "module.py").read_bytes() == b"VALUE = 42\n"


@pytest.mark.platforms("posix")
def test_lock_pruning_keeps_the_archive_behind_a_normalized_package_name(tmp_path):
    source = tmp_path / "build-cache"
    archive = source / "archive-v0/bucket"
    (archive / "ruamel.yaml-0.18.16.dist-info").mkdir(parents=True)
    (archive / "module.py").write_bytes(b"VALUE = 42\n")
    index = source / "wheels-v6/pypi/ruamel-yaml/0.18.16-py3-none-any"
    index.parent.mkdir(parents=True)
    index.symlink_to(Path("../../../archive-v0/bucket"), target_is_directory=True)
    project = tmp_path / "project"
    project.mkdir()
    (project / "uv.lock").write_text('[[package]]\nname = "ruamel-yaml"\nversion = "0.18.16"\n')

    staged = tmp_path / "payload-cache"
    stage_uv_cache(source, staged)
    prune_uv_cache_to_lock(staged, project)

    assert (staged / index.relative_to(source) / "module.py").read_bytes() == b"VALUE = 42\n"
    assert (staged / "archive-v0/bucket/module.py").exists()
