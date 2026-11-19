"""An explicit release binary enables the local Codex protocol acceptance test."""

import pytest


def pytest_addoption(parser):
    parser.addoption("--aino-codex-test-binary", default=None, help="Codex binary for loopback-only acceptance tests")


@pytest.fixture
def codex_test_binary(request):
    path = request.config.getoption("--aino-codex-test-binary")
    if not path:
        pytest.skip("An explicit bundled Codex fixture is required")
    return path
