"""Installer fixtures require PM's dependency interpreter before expensive acceptance."""
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sys
import venv

import pytest


@pytest.fixture
def helper():
    path = Path(__file__).resolve().parents[2] / "install/e2e-assets/windows-fixture-python.py"
    spec = spec_from_file_location("windows_fixture_python", path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fixture_interpreter_comes_from_original_pm_test_selection_without_installing(tmp_path, monkeypatch, helper):
    from pm.environments import venv_python
    from pm.testenv import testenv_root

    repo = Path(__file__).resolve().parents[3]
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "setup-pm"))
    monkeypatch.setenv("HERMES_PYTHON", sys.executable)
    with pytest.raises(RuntimeError, match="test-environment"):
        helper.selected_fixture_python(repo)
    selection = testenv_root(repo)
    generation = "gen-" + "a" * 32
    environment = selection / generation / "venv"
    python = venv_python(environment)
    python.parent.mkdir(parents=True)
    python.write_bytes(b"interpreter selection fixture")
    (environment / "pyvenv.cfg").write_text("home = fixture\n", encoding="utf-8")
    selected = selection / "active.json"
    selected.write_text(json.dumps({"generation": generation}), encoding="utf-8")
    before = {path.relative_to(selection): path.read_bytes() for path in selection.rglob("*") if path.is_file()}
    assert helper.selected_fixture_python(repo) == python.absolute()
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "acceptance-home"))
    with pytest.raises(RuntimeError, match="test-environment"):
        helper.selected_fixture_python(repo)
    after = {path.relative_to(selection): path.read_bytes() for path in selection.rglob("*") if path.is_file()}
    assert after == before


def test_fixture_probe_executes_real_sessiondb_and_rejects_bootstrap_python(tmp_path, helper):
    from pm.environments import venv_python

    repo = Path(__file__).resolve().parents[3]
    proof = helper.probe_fixture_python(Path(sys.executable), repo, tmp_path)
    assert proof["sessionDb"] == {"created": True, "messagesRead": 2}
    assert proof["python"] == str(Path(sys.executable).absolute())
    assert not list(tmp_path.glob("fixture-python-*"))
    bare = tmp_path / "bootstrap"
    venv.EnvBuilder(with_pip=False).create(bare)
    with pytest.raises(RuntimeError, match="SessionDB preflight failed"):
        helper.probe_fixture_python(venv_python(bare), repo, tmp_path)
    assert not list(tmp_path.glob("fixture-python-*"))
