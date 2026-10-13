"""The CLI must discover the desktop product that electron-builder shipped."""

import os
import struct
from pathlib import Path

import pytest

from hermes_cli import main_desktop


def _write_executable(path: Path, machine: int | None = None) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".exe":
        if machine is None:
            machine = next(iter(main_desktop._expected_windows_pe_machines()))
        data = bytearray(0x400)
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 0x3C, 0x80)
        data[0x80:0x84] = b"PE\x00\x00"
        struct.pack_into("<HHIIIHH", data, 0x84, machine, 1, 0, 0, 0, 0, 0x0002)
        struct.pack_into("<II", data, 0x98 + 16, 0x200, 0x200)
        path.write_bytes(data)
    else:
        path.write_bytes(b"desktop executable")
    return path


@pytest.mark.parametrize(
    ("primary_path", "legacy_path"),
    [
        pytest.param(
            "mac-arm64/Aino.app/Contents/MacOS/Aino",
            "mac/Hermes.app/Contents/MacOS/Hermes",
            marks=pytest.mark.platforms("macos"),
            id="macos",
        ),
        pytest.param(
            "linux-unpacked/Aino", "linux-arm64-unpacked/hermes",
            marks=pytest.mark.platforms("linux"),
            id="linux",
        ),
        pytest.param(
            "win-unpacked/Aino.exe", "win-arm64-unpacked/Hermes.exe",
            marks=pytest.mark.platforms("windows"),
            id="windows",
        ),
    ],
)
def test_packaged_executable_prefers_current_product_with_legacy_fallback(
    tmp_path, primary_path, legacy_path
):
    release = tmp_path / "release"
    legacy = _write_executable(release / legacy_path)
    assert main_desktop._desktop_packaged_executable_in(release) == legacy

    primary = _write_executable(release / primary_path)
    os.utime(primary, (100, 100))
    os.utime(legacy, (200, 200))
    assert main_desktop._desktop_packaged_executable_in(release) == primary
    assert main_desktop._desktop_packaged_executable(tmp_path) == primary

    primary.unlink()
    assert main_desktop._desktop_packaged_executable_in(release) == legacy


@pytest.mark.platforms("windows")
def test_windows_architecture_preference_precedes_product_preference(tmp_path):
    """An Aino build for an unloadable PE machine must not hide a runnable app."""
    release = tmp_path / "release"
    runnable_machine = next(iter(main_desktop._expected_windows_pe_machines()))
    legacy = _write_executable(release / "win-unpacked/Hermes.exe", runnable_machine)
    incompatible = _write_executable(release / "win-arm64-unpacked/Aino.exe", 0x01F0)
    os.utime(legacy, (100, 100))
    os.utime(incompatible, (200, 200))
    assert main_desktop._desktop_packaged_executable_in(release) == legacy

    primary = _write_executable(release / "win-unpacked/Aino.exe", runnable_machine)
    os.utime(primary, (50, 50))
    assert main_desktop._desktop_packaged_executable_in(release) == primary
