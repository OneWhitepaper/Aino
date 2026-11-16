"""App Installer checker output contracts and native WinRT dependency coverage.

Stubbed subprocess checks cover OS outcomes without a packaged process.
The native Windows test checks the URI and async projection types.

Root causes pinned here (audit C08):
- ``Package.current`` is a PROPERTY, not a callable.
- ``PackageManager.check_package_update_availability_async`` does not exist;
  the method lives on the Package instance.
- The update method rejects ``Package.current``; resolve its identity through
  ``PackageManager.FindPackageForUser`` before checking the returned object.
- A not-packaged process is identifiable by the package-identity HRESULT
  (0x80073D54); ANY other failure must surface as unknown, never as
  "no update".
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest


HERMES_PYTHON = sys.executable
REPO = Path(__file__).resolve().parents[2]
MODULE = "hermes_cli.windows_appinstaller_update"


@pytest.fixture
def resolved_projection(monkeypatch):
    import enum
    import importlib
    from types import SimpleNamespace

    availability = enum.IntEnum("Availability", "UNKNOWN NO_UPDATES AVAILABLE REQUIRED ERROR", start=0)
    calls = []
    state = SimpleNamespace(lookup="resolved", source="registered")
    full_name = "HermesFixture_1.2.3.0_x64__fixture"

    class CurrentPackage:
        id = SimpleNamespace(full_name=full_name)

        def get_app_installer_info(self):
            return SimpleNamespace(uri=SimpleNamespace(absolute_uri="https://current.example/not-queried"))

        def check_update_availability_async(self):
            calls.append("current-check")
            raise PermissionError("Access denied on Package.current")

    class ResolvedPackage:
        def get_app_installer_info(self):
            if state.source == "error":
                raise PermissionError("registered source permission denied")
            if state.source == "missing":
                return None
            return SimpleNamespace(uri=SimpleNamespace(absolute_uri=
                "" if state.source == "blank" else "https://registered.example/updates.appinstaller"))

        def check_update_availability_async(self):
            calls.append("resolved-check")
            return SimpleNamespace(get=lambda: SimpleNamespace(availability=availability.AVAILABLE))

    class PackageManager:
        def find_package_by_user_security_id_package_full_name(self, user, name):
            calls.append((user, name))
            if state.lookup == "error":
                error = OSError("lookup failure")
                error.winerror = -2147009196
                raise error
            return None if state.lookup == "missing" else ResolvedPackage()

    monkeypatch.setitem(sys.modules, "winrt.windows.applicationmodel", SimpleNamespace(
        Package=SimpleNamespace(current=CurrentPackage()), PackageUpdateAvailability=availability))
    monkeypatch.setitem(sys.modules, "winrt.windows.management.deployment", SimpleNamespace(PackageManager=PackageManager))
    return importlib.import_module(MODULE).main, calls, state, full_name


def test_update_check_uses_the_user_resolved_package_instead_of_the_denied_current_object(resolved_projection, capsys):
    main, calls, _state, full_name = resolved_projection
    assert main() == 2
    assert json.loads(capsys.readouterr().out) == {
        "available": True, "availability": "AVAILABLE", "source_uri": "https://registered.example/updates.appinstaller",
    }
    assert calls == [("", full_name), "resolved-check"]


def test_source_only_reads_fresh_resolved_source_without_network_availability(resolved_projection, capsys):
    main, calls, _state, full_name = resolved_projection
    assert main(source_only=True) == 0
    assert json.loads(capsys.readouterr().out) == {
        "source_resolution": "registered", "source_uri": "https://registered.example/updates.appinstaller",
    }
    assert calls == [("", full_name)]


@pytest.mark.parametrize("lookup,source", [("error", "registered"), ("missing", "registered"),
                                          ("resolved", "error"), ("resolved", "missing"), ("resolved", "blank")])
def test_source_only_source_or_lookup_failure_is_error_without_availability(resolved_projection, capsys, lookup, source):
    main, calls, state, full_name = resolved_projection
    state.lookup, state.source = lookup, source
    assert main(source_only=True) == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["source_resolution"] == "error"
    assert payload["error"]
    assert "available" not in payload
    assert "availability" not in payload
    assert calls == [("", full_name)]


@pytest.mark.parametrize("lookup", ["error", "missing"])
def test_package_lookup_failure_is_unknown_even_for_the_no_identity_hresult(resolved_projection, capsys, lookup):
    main, calls, state, full_name = resolved_projection
    state.lookup = lookup
    assert main() == 1
    payload = json.loads(capsys.readouterr().out)
    assert payload["available"] is None
    assert payload["error"].startswith("check failed:")
    assert calls == [("", full_name)]


@pytest.mark.parametrize("state,code,available", [
    ("not-packaged", 0, False), ("AVAILABLE", 2, True), ("REQUIRED", 2, True),
    ("NO_UPDATES", 0, False), ("UNKNOWN", 1, None), ("ERROR", 1, None),
    ("no-source", 1, None), ("check-error", 1, None), ("identity-error", 1, None),
    ("invalid-availability", 1, None),
    ("missing-projection", 1, None), ("missing-current", 1, None),
])
def test_projection_outcomes(monkeypatch, capsys, state, code, available):
    import enum
    import importlib
    from types import SimpleNamespace

    main = importlib.import_module(MODULE).main
    availability = enum.IntEnum("Availability", "UNKNOWN NO_UPDATES AVAILABLE REQUIRED ERROR", start=0)
    class PackageInstance:
        id = SimpleNamespace(full_name="HermesFixture_1.2.3.0_x64__fixture")

        def get_app_installer_info(self):
            return None if state == "no-source" else SimpleNamespace(
                uri=SimpleNamespace(absolute_uri="https://registered.example/updates.appinstaller"))

        def check_update_availability_async(self):
            def get():
                if state == "check-error":
                    raise RuntimeError("rpc boom")
                return SimpleNamespace(availability=999 if state == "invalid-availability" else availability[state])
            return SimpleNamespace(get=get)

    class PackageMeta(type):
        @property
        def current(cls):
            if state in ("not-packaged", "identity-error"):
                error = OSError("identity failure")
                error.winerror = -2147009196 if state == "not-packaged" else -2147024891
                raise error
            return PackageInstance()

    class Package(metaclass=PackageMeta):
        pass

    class PackageManager:
        def find_package_by_user_security_id_package_full_name(self, user, name):
            assert (user, name) == ("", PackageInstance.id.full_name)
            return PackageInstance()

    def load():
        if state == "missing-projection":
            raise ImportError("missing winrt")
        return (object if state == "missing-current" else Package), availability, PackageManager

    monkeypatch.setitem(main.__globals__, "_load_projection", load)
    assert main() == code
    payload = json.loads(capsys.readouterr().out)
    assert payload["available"] is available
    if state == "not-packaged":
        assert payload == {"available": False, "reason": "not-packaged"}
    elif state in ("AVAILABLE", "REQUIRED", "NO_UPDATES"):
        assert payload["availability"] == state
        assert payload["source_uri"] == "https://registered.example/updates.appinstaller"
    else:
        assert payload["error"]
        if state == "no-source":
            assert payload["reason"] == "no-app-installer-source"
            assert ".appinstaller" in payload["error"]


@pytest.mark.parametrize("source_only", [False, True])
def test_script_import_failure_json_and_exit(tmp_path, source_only):
    # A real subprocess runs the entry the desktop spawns (python -P -m) and
    # imports the absent projection.
    (tmp_path / "winrt.py").write_text("raise ImportError('fixture unavailable')", encoding="utf-8")
    child = subprocess.run([HERMES_PYTHON, "-P", "-m", MODULE, *(["--source-only"] if source_only else [])], capture_output=True,
                           text=True, timeout=30,
                           env={**os.environ, "PYTHONPATH": os.pathsep.join([str(REPO), str(tmp_path)])}, check=False)
    assert child.returncode == 1, child.stderr
    payload = json.loads(child.stdout)
    if source_only:
        assert payload["source_resolution"] == "error"
        assert "available" not in payload
        assert "availability" not in payload
    else:
        assert payload["available"] is None
    assert "fixture unavailable" in payload["error"]


@pytest.mark.parametrize("state", ["not-packaged", "denied", "unexpected", "missing-current", "missing-projection"])
def test_source_only_identity_outcomes_are_disjoint_and_only_no_identity_is_manual(monkeypatch, capsys, state):
    import importlib

    main = importlib.import_module(MODULE).main

    class PackageMeta(type):
        @property
        def current(cls):
            if state == "unexpected":
                raise RuntimeError("identity read failed")
            error = OSError("identity failure")
            error.winerror = -2147009196 if state == "not-packaged" else -2147024891
            raise error

    class Package(metaclass=PackageMeta):
        pass

    def load():
        if state == "missing-projection":
            raise ImportError("missing winrt")
        return (object if state == "missing-current" else Package), object, object

    monkeypatch.setitem(main.__globals__, "_load_projection", load)
    assert main(source_only=True) == (0 if state == "not-packaged" else 1)
    payload = json.loads(capsys.readouterr().out)
    assert "available" not in payload
    assert "availability" not in payload
    if state == "not-packaged":
        assert payload == {"source_resolution": "not-packaged"}
    else:
        assert payload["source_resolution"] == "error"
        assert payload["error"]


def test_source_only_cli_resolves_registered_source_without_calling_network_method(tmp_path):
    package = tmp_path / "winrt" / "windows"
    deployment = package / "management"
    deployment.mkdir(parents=True)
    for folder in [tmp_path / "winrt", package, deployment]:
        (folder / "__init__.py").write_text("", encoding="utf-8")
    (package / "applicationmodel.py").write_text(textwrap.dedent("""\
        from types import SimpleNamespace
        Package = SimpleNamespace(current=SimpleNamespace(id=SimpleNamespace(full_name='Fixture_1.0.0.0_x64__fixture')))
        PackageUpdateAvailability = object
        """), encoding="utf-8")
    (deployment / "deployment.py").write_text(textwrap.dedent("""\
        from types import SimpleNamespace
        class ResolvedPackage:
            def get_app_installer_info(self):
                return SimpleNamespace(uri=SimpleNamespace(absolute_uri='https://registered.example/update.appinstaller'))
            def check_update_availability_async(self):
                raise AssertionError('source-only must not contact the update source')
        class PackageManager:
            def find_package_by_user_security_id_package_full_name(self, user, name):
                assert (user, name) == ('', 'Fixture_1.0.0.0_x64__fixture')
                return ResolvedPackage()
        """), encoding="utf-8")
    child = subprocess.run(
        [HERMES_PYTHON, "-P", "-m", MODULE, "--source-only"], capture_output=True, text=True, timeout=30,
        env={**os.environ, "PYTHONPATH": os.pathsep.join([str(REPO), str(tmp_path)])}, check=False)
    assert child.returncode == 0, child.stderr
    assert json.loads(child.stdout) == {
        "source_resolution": "registered", "source_uri": "https://registered.example/update.appinstaller",
    }
    assert child.stderr == ""


@pytest.mark.platforms("windows")
def test_installed_winrt_projects_checker_uri_and_async_types(tmp_path):
    # A dev process has no package identity, so exercise the types that the
    # packaged update call projects only after Package.current succeeds.
    probe = subprocess.run(
        [HERMES_PYTHON, "-I", "-c",
         f"import sys; sys.path.insert(0, {str(REPO)!r}); "
         f"from {MODULE} import _load_projection; "
         "from winrt.windows.foundation import IAsyncOperation, Uri; "
         "uri = Uri('https://example.invalid/updates.appinstaller'); "
         "assert uri.absolute_uri == 'https://example.invalid/updates.appinstaller'; "
         "assert callable(IAsyncOperation.get); "
         "Package, Availability, PackageManager = _load_projection(); "
         "manager = PackageManager(); "
         "assert callable(manager.find_package_by_user_security_id_package_full_name); "
         "print('WINRT_CHECKER_TYPES_OK')"],
        cwd=tmp_path, capture_output=True, text=True, timeout=30,
        check=False,
    )
    assert probe.returncode == 0, probe.stderr
    assert probe.stdout.strip() == "WINRT_CHECKER_TYPES_OK"
