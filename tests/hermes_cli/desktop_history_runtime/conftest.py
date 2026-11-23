"""Optional offline probe against the actual pinned desktop engine."""

import pytest


@pytest.fixture
def homes(tmp_path):
    source, target = tmp_path / "legacy", tmp_path / "account"
    source.mkdir()
    target.mkdir()
    return source, target


def pytest_addoption(parser):
    parser.addoption("--code-history-codex", default=None, help="Path to the pinned Codex engine for offline recovery probes")
