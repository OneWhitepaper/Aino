"""Limit maintenance-test process discovery to owned children, keeping real descriptor scans."""

from types import SimpleNamespace

import psutil
import pytest

from persistence.sqlite._state import holders as holders_module


@pytest.fixture
def owned_holder_processes(monkeypatch):
    """Do not inspect unrelated desktop processes or the real account's open files."""
    pids: set[int] = set()

    def process_iter(attrs):
        for pid in sorted(pids):
            try:
                process = psutil.Process(pid)
                process.info = process.as_dict(attrs=attrs)
            except psutil.NoSuchProcess:
                continue
            yield process

    # Patch only the scanner's module binding, not psutil used by test-process cleanup.
    projected_psutil = SimpleNamespace(**{**vars(psutil), "process_iter": process_iter})
    monkeypatch.setattr(holders_module, "psutil", projected_psutil)
    return pids
