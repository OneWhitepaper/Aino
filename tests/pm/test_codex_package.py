"""The bundled coding engine keeps its executor and platform sandbox beside it."""

import hashlib
import json
import shutil
import tarfile

import pytest

from pm import Lockfile, Store, get_package, paths
from pm.package import InstallError
from pm.registry import source_install_packages
from scripts.bundles.native import _bundle_package_names
from tests.pm._fixtures import served as served  # noqa: PLC0414 -- pytest discovers this imported fixture through its module binding


TARGETS = [
    ("darwin-arm64", "aarch64-apple-darwin", ""),
    ("darwin-x64", "x86_64-apple-darwin", ""),
    ("linux-arm64", "aarch64-unknown-linux-musl", ""),
    ("linux-x64", "x86_64-unknown-linux-musl", ""),
    ("linux-arm64-musl", "aarch64-unknown-linux-musl", ""),
    ("linux-x64-musl", "x86_64-unknown-linux-musl", ""),
    ("win32-arm64", "aarch64-pc-windows-msvc", ".exe"),
    ("win32-x64", "x86_64-pc-windows-msvc", ".exe"),
]


def package_archive(tmp_path, target, triple, extension, *, missing="", version="1.2.3", notices=True):
    source = tmp_path / "source"
    members = [f"bin/{name}{extension}" for name in ("codex", "codex-code-mode-host", "codex-exec-server")]
    members.append(f"codex-path/rg{extension}")
    if notices:
        members.extend(("LICENSE", "NOTICE"))
    resources = {
        "linux": ["bwrap"],
        "win32": ["codex-command-runner.exe", "codex-windows-sandbox-setup.exe"],
        "darwin": ["voice/NOTICE.md"],
    }[target.split("-")[0]]
    members.extend(f"codex-resources/{name}" for name in resources)
    for name in members:
        if name != missing:
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
    (source / "codex-resources").mkdir(exist_ok=True)
    (source / "codex-package.json").write_text(json.dumps({
        "layoutVersion": 1, "version": version, "target": triple, "variant": "codex",
        "entrypoint": f"bin/codex{extension}", "execServer": f"bin/codex-exec-server{extension}",
        "resourcesDir": "codex-resources", "pathDir": "codex-path",
    }))
    archive = tmp_path / "package.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(source, arcname=".")
    return archive, source, members


@pytest.mark.parametrize("name", ["LICENSE", "NOTICE"])
def test_pinned_distribution_notices_are_kept_verbatim(tmp_path, name):
    artifact = tmp_path / name
    artifact.write_bytes(b"upstream distribution notice\n")
    staged = tmp_path / "staged-notice"
    get_package("codex").unpack(artifact, staged, "darwin-arm64")
    assert (staged / name).read_bytes() == artifact.read_bytes()


@pytest.mark.parametrize("target,triple,extension", TARGETS)
def test_staged_package_keeps_the_full_upstream_layout(tmp_path, target, triple, extension):
    package = get_package("codex")
    archive, source, members = package_archive(tmp_path, target, triple, extension)
    staged = tmp_path / "staged"
    package.unpack(archive, staged, target)
    package.stage(Store(tmp_path / "store"), staged, "1.2.3", target)
    assert package.binary(staged, target) == staged / f"bin/codex{extension}"
    assert package.env(staged, target)["PATH"] == [str(staged / "bin")]
    for member in members:
        assert (staged / member).read_bytes() == (source / member).read_bytes()


@pytest.mark.parametrize("target,triple,extension,missing", [
    ("darwin-arm64", "aarch64-apple-darwin", "", "bin/codex-exec-server"),
    ("darwin-x64", "x86_64-apple-darwin", "", "bin/codex-code-mode-host"),
    ("linux-x64", "x86_64-unknown-linux-musl", "", "codex-resources/bwrap"),
    ("win32-x64", "x86_64-pc-windows-msvc", ".exe", "codex-resources/codex-command-runner.exe"),
    ("win32-arm64", "aarch64-pc-windows-msvc", ".exe", "codex-resources/codex-windows-sandbox-setup.exe"),
    ("darwin-arm64", "aarch64-apple-darwin", "", "codex-path/rg"),
    ("darwin-arm64", "aarch64-apple-darwin", "", "LICENSE"),
])
def test_incomplete_package_cannot_be_published(tmp_path, target, triple, extension, missing):
    package = get_package("codex")
    archive, _source, _members = package_archive(tmp_path, target, triple, extension, missing=missing)
    staged = tmp_path / "staged"
    package.unpack(archive, staged, target)
    with pytest.raises(InstallError, match="missing"):
        package.stage(Store(tmp_path / "store"), staged, "1.2.3", target)
    assert "missing" in package.verify(staged, target)


@pytest.mark.parametrize("mismatch", ["version", "target", "entrypoint"])
def test_package_metadata_must_match_the_selected_pin(tmp_path, mismatch):
    package = get_package("codex")
    archive, _source, _members = package_archive(tmp_path, "darwin-arm64", "aarch64-apple-darwin", "")
    staged = tmp_path / "staged"
    package.unpack(archive, staged, "darwin-arm64")
    metadata = json.loads((staged / "codex-package.json").read_text())
    metadata[mismatch] = {"version": "9.9.9", "target": "x86_64-apple-darwin", "entrypoint": "../outside"}[mismatch]
    (staged / "codex-package.json").write_text(json.dumps(metadata))
    with pytest.raises(InstallError, match=mismatch):
        package.stage(Store(tmp_path / "store"), staged, "1.2.3", "darwin-arm64")


def test_desktop_carries_codex_while_source_install_keeps_it_optional():
    lock = Lockfile(paths.lockfile_path())
    package = get_package("codex")
    version = lock.version("codex")
    assert version
    assert "codex" not in source_install_packages(lock.names())
    for target, _triple, _extension in TARGETS:
        assert "codex" in _bundle_package_names(target)
        artifacts = lock.artifacts("codex", target)
        assert artifacts and all(row["sha256"] for row in artifacts)
        assert [row["url"] for row in artifacts] == package.fetch_urls(version, target)
    assert package.missing_reason("linux-arm64-bionic")


def test_incomplete_lock_cannot_silently_omit_the_desktop_engine(tmp_path, monkeypatch):
    from scripts.bundles import native

    lock_path = tmp_path / "empty-lock.json"
    lock = Lockfile(lock_path)
    monkeypatch.setattr(native, "_lockfile", lambda: lock)
    # Keeping the required package in the request makes PM fail on its absent
    # pin; silently pruning it would publish an app requiring another install.
    assert "codex" in native._bundle_package_names("darwin-arm64")


@pytest.mark.parametrize("corrupt", [False, True])
def test_bundle_preparation_verifies_artifacts_before_publishing(tmp_path, monkeypatch, served, corrupt):
    from pm.build_operations import prepare_tools
    from pm.lock import Facts
    from pm.store import current_target

    package = get_package("codex")
    # This fixture exercises acquisition/layout/publication; fake payload bytes
    # cannot execute, so only the final native version probe is disabled.
    monkeypatch.setattr(package, "probe_version", False)
    target = current_target()
    _target, triple, extension = next(row for row in TARGETS if row[0] == target)
    archive, _source, _members = package_archive(tmp_path, target, triple, extension, notices=False)
    docroot, base_url = served
    shutil.copy2(archive, docroot / "package.tar.gz")
    artifacts = [{"url": base_url + "/package.tar.gz", "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}]
    for name in ("LICENSE", "NOTICE"):
        content = b"pinned distribution notice\n"
        (docroot / name).write_bytes(content)
        artifacts.append({"url": f"{base_url}/{name}", "sha256": hashlib.sha256(content).hexdigest()})
    if corrupt:
        (docroot / "NOTICE").write_bytes(b"wrong artifact\n")
    lock_path = tmp_path / "lock.json"
    lock = Lockfile(lock_path)
    lock.set_pin("codex", "1.2.3", {target: artifacts})
    lock.save()
    monkeypatch.setattr(paths, "lockfile_path", lambda: lock_path)
    monkeypatch.setattr(paths, "partials_root", lambda: tmp_path / "partials")
    out = tmp_path / "payload-tools"
    if corrupt:
        with pytest.raises(InstallError):
            prepare_tools(["codex"], out=out, target=target)
        assert not Facts(out / "facts.json").get("codex")
        assert not (out / package.store_entry("1.2.3", target)).exists()
        return
    prepare_tools(["codex"], out=out, target=target)
    fact = Facts(out / "facts.json").get("codex")
    assert fact and fact["artifacts"] == [row["sha256"] for row in artifacts]
    assert (out / fact["entry"] / "NOTICE").read_bytes() == b"pinned distribution notice\n"
