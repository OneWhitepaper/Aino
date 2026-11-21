"""MoA cache isolation must preserve the minimal installer's dependency boundary."""

from contextlib import contextmanager
import importlib
import sys

import pytest

from tests import conftest as suite_fixtures


@contextmanager
def _cache_boundary():
    boundary = suite_fixtures._moa_caches_isolated.__wrapped__()
    next(boundary)
    try:
        yield
    finally:
        with pytest.raises(StopIteration):
            next(boundary)


def test_unused_moa_is_not_imported_by_cache_isolation(monkeypatch):
    # None makes the real import machinery reject an unavailable optional module.
    monkeypatch.setitem(sys.modules, "agent.moa_loop", None)

    with _cache_boundary():
        assert sys.modules["agent.moa_loop"] is None

    assert sys.modules["agent.moa_loop"] is None


@pytest.mark.parametrize("loaded_before", [True, False])
def test_moa_caches_are_cleared_at_fixture_boundaries(monkeypatch, loaded_before):
    moa = importlib.import_module("agent.moa_loop")
    if loaded_before:
        moa._preset_cache["previous-test"] = object()
        moa._runtime_cache["previous-test"] = object()
    else:
        monkeypatch.delitem(sys.modules, "agent.moa_loop")
        monkeypatch.delattr(importlib.import_module("agent"), "moa_loop")

    with _cache_boundary():
        if not loaded_before:
            assert "agent.moa_loop" not in sys.modules
            moa = importlib.import_module("agent.moa_loop")
        assert moa._preset_cache == {}
        assert moa._runtime_cache == {}
        moa._preset_cache["current-test"] = object()
        moa._runtime_cache["current-test"] = object()

    assert moa._preset_cache == {}
    assert moa._runtime_cache == {}
