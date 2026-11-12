"""Doctor repairs must seed the same product identity as normal initialization."""

import pytest

from hermes_cli import doctor
from hermes_cli.config import _ensure_default_soul_md
from hermes_cli.default_soul import DEFAULT_SOUL_MD


OLD_DOCTOR_SOUL = (
    "# Hermes Agent Persona\n\n<!-- Edit this file to customize how Hermes communicates. -->\n\n"
    "You are Hermes, a helpful AI assistant.\n"
)


@pytest.fixture
def doctor_home(tmp_path, monkeypatch):
    monkeypatch.setattr(doctor, "HERMES_HOME", tmp_path)
    monkeypatch.setattr(doctor, "_DHH", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path


def test_doctor_fix_seeds_the_shared_default_persona(doctor_home):
    doctor._check_directory_structure(True)

    assert (doctor_home / "SOUL.md").read_text() == DEFAULT_SOUL_MD


def test_doctor_without_fix_leaves_the_old_seed_untouched(doctor_home):
    soul = doctor_home / "SOUL.md"
    soul.write_text(OLD_DOCTOR_SOUL)

    doctor._check_directory_structure(False)

    assert soul.read_text() == OLD_DOCTOR_SOUL


@pytest.mark.parametrize("repair", ["initialize", "doctor"])
def test_exact_old_doctor_seed_migrates_without_overwriting_a_custom_persona(doctor_home, repair):
    soul = doctor_home / "SOUL.md"
    soul.write_text(OLD_DOCTOR_SOUL)
    if repair == "initialize":
        _ensure_default_soul_md(doctor_home)
    else:
        doctor._check_directory_structure(True)
    assert soul.read_text() == DEFAULT_SOUL_MD

    customized = OLD_DOCTOR_SOUL + "Always use my chosen persona.\n"
    soul.write_text(customized)
    if repair == "initialize":
        _ensure_default_soul_md(doctor_home)
    else:
        doctor._check_directory_structure(True)
    assert soul.read_text() == customized
