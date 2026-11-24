"""Behavioral tests for the state-holder and repair-admission authority."""

import os
import errno
from types import SimpleNamespace

import pytest

from persistence.sqlite._state import holders as holders_module


@pytest.mark.platforms("macos")
def test_filtered_holder_scan_does_not_open_unrelated_process_descriptors(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    db_path.touch()
    inspected = []

    class Process:
        def __init__(self, pid):
            self.info = {"pid": pid}

        def open_files(self):
            inspected.append(self.info["pid"])
            return [SimpleNamespace(path=str(db_path))]

    def processes(attrs):
        assert attrs == ["pid"]
        return [Process(4242), Process(4243)]

    monkeypatch.setattr(holders_module.psutil, "process_iter", processes)
    assert holders_module.foreign_state_db_holders(db_path, process_filter=lambda pid: pid == 4242) == [
        (4242, str(db_path))]
    assert inspected == [4242]


@pytest.mark.platforms("macos")
def test_holder_scan_keeps_watched_file_stat_failures(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    db_path.touch()
    projected_os = SimpleNamespace(**vars(os))
    real_stat = os.stat

    def stat(path, *args, **kwargs):
        if str(path) == str(db_path):
            raise PermissionError(errno.EACCES, "denied", str(path))
        return real_stat(path, *args, **kwargs)

    projected_os.stat = stat
    monkeypatch.setattr(holders_module, "os", projected_os)
    monkeypatch.setattr(holders_module.psutil, "process_iter", lambda attrs: [])
    assert any(pid == -1 and "stat failed" in reason for pid, reason in holders_module.foreign_state_db_holders(db_path))
    assert holders_module.held_store_refusal(db_path, command="repair") is not None


@pytest.mark.platforms("macos")
@pytest.mark.parametrize("failure", ["gone", "denied"])
def test_filtered_holder_scan_keeps_later_holders_after_a_process_race(tmp_path, monkeypatch, failure):
    db_path = tmp_path / "state.db"
    db_path.touch()

    class Process:
        def __init__(self, pid):
            self.info = {"pid": pid}

        def open_files(self):
            if self.info["pid"] == 4242:
                error = holders_module.psutil.NoSuchProcess if failure == "gone" else holders_module.psutil.AccessDenied
                raise error(4242)
            return [SimpleNamespace(path=str(db_path))]

    monkeypatch.setattr(holders_module.psutil, "process_iter", lambda attrs: [Process(4242), Process(4243)])
    holders = holders_module.foreign_state_db_holders(db_path, process_filter=lambda pid: True)
    assert (4243, str(db_path)) in holders
    assert any(pid == 4242 for pid, _ in holders) is (failure == "denied")


@pytest.mark.platforms("macos")
def test_holder_scan_does_not_resolve_unrelated_open_file_paths(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    db_path.touch()
    unrelated = str(tmp_path / "unrelated")
    projected_os = SimpleNamespace(**{**vars(os), "path": SimpleNamespace(**vars(os.path))})
    realpath = os.path.realpath

    def resolve(path, **kwargs):
        if str(path) == unrelated:
            raise AssertionError("an unrelated descriptor must not trigger file I/O")
        return realpath(path, **kwargs)

    projected_os.path.realpath = resolve
    monkeypatch.setattr(holders_module, "os", projected_os)
    monkeypatch.setattr(holders_module.psutil, "process_iter", lambda attrs: [SimpleNamespace(
        info={"pid": 4242, "open_files": [SimpleNamespace(path=unrelated)]})])
    assert holders_module.foreign_state_db_holders(db_path) == []


@pytest.mark.platforms("macos")
def test_open_file_paths_report_the_kernel_resolved_symlink_target(tmp_path):
    target = tmp_path / "state.db"
    target.touch()
    alias = tmp_path / "alias.db"
    alias.symlink_to(target)
    with alias.open("rb"):
        paths = {opened.path for opened in holders_module.psutil.Process().open_files()}
    assert str(target.resolve()) in paths
    assert str(alias) not in paths


@pytest.mark.platforms("linux")
@pytest.mark.parametrize("identity", ["alias", "different-inode", "different-device"])
def test_foreign_holder_uses_device_and_inode_not_path(
    tmp_path, monkeypatch, identity
):
    """Descriptor identity is authoritative even when /proc spells another path."""
    db_path = tmp_path / "state.db"
    db_path.touch()
    alias_path = tmp_path / "namespace-alias" / "state.db" if identity == "alias" else db_path

    proc_root = tmp_path / "proc"
    for pid in (111, 222):
        (proc_root / str(pid) / "fd").mkdir(parents=True)
    os.symlink(db_path, proc_root / "222" / "fd" / "3")

    # Keep the /proc projection local: patching os globally also intercepts
    # pytest's home guard and pathlib while they inspect these same symlinks.
    projected_os = SimpleNamespace(**vars(os))
    projected_os.getpid = lambda: 111
    monkeypatch.setattr(holders_module, "os", projected_os)
    real_listdir = os.listdir

    def _listdir(path):
        if isinstance(path, str):
            path = path.replace("/proc", str(proc_root))
        return real_listdir(path)

    monkeypatch.setattr(holders_module.os, "listdir", _listdir)

    def _readlink(path):
        if path == "/proc/222/fd/3":
            return str(alias_path)
        return os.readlink(path.replace("/proc", str(proc_root)))

    monkeypatch.setattr(holders_module.os, "readlink", _readlink)
    real_stat = os.stat

    def _stat(path, *args, **kwargs):
        mapped = str(path).replace("/proc", str(proc_root))
        result = real_stat(mapped, *args, **kwargs)
        if str(path) == "/proc/222/fd/3" and identity != "alias":
            values = list(result)
            values[1 if identity == "different-inode" else 2] += 1
            return os.stat_result(values)
        return result

    monkeypatch.setattr(holders_module.os, "stat", _stat)

    assert holders_module.foreign_state_db_holders(db_path) == (
        [(222, str(alias_path))] if identity == "alias" else []
    )


def test_windows_restart_manager_scan_sizes_then_excludes_self(monkeypatch, tmp_path):
    """The rstrtmgr lane sizes on ERROR_MORE_DATA, drops our own pid, and fails closed."""
    import ctypes

    db_path = tmp_path / "state.db"
    db_path.touch()
    (tmp_path / "state.db-wal").touch()
    calls = []

    class _Fn:
        def __init__(self, impl):
            self.impl = impl

        def __call__(self, *args):
            return self.impl(*args)

    def start(session, _flags, _key):
        session._obj.value = 7
        return 0

    def register(_session, count, names, *_rest):
        calls.append(("register", count, sorted(names)))
        return 0

    def get_list(_session, needed, count, apps, _reasons):
        needed._obj.value = 2
        if apps is None:
            return 234  # ERROR_MORE_DATA: sizing call
        apps[0].process.pid = os.getpid()
        apps[1].process.pid = 4242
        count._obj.value = 2
        return 0

    class _Api:
        RmStartSession = _Fn(start)
        RmRegisterResources = _Fn(register)
        RmGetList = _Fn(get_list)
        RmEndSession = _Fn(lambda _session: calls.append("end") or 0)

    monkeypatch.setattr(ctypes, "WinDLL", lambda *a, **k: _Api(), raising=False)

    holders = holders_module._windows_restart_manager_holders(db_path)

    assert [pid for pid, _ in holders] == [4242]
    assert calls[0] == ("register", 2, sorted(str(p) for p in (db_path, tmp_path / "state.db-wal")))
    assert calls[-1] == "end"

    _Api.RmStartSession = _Fn(lambda *_args: 5)
    with pytest.raises(OSError):
        holders_module._windows_restart_manager_holders(db_path)
