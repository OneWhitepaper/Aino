"""Children retain a parent's authority without allowing endpoint/key mixing."""

import pytest

from tests.tui_gateway.test_managed_model_agent import managed_gateway
from tui_gateway import server as srv
from tui_gateway.managed_model_usage import begin_managed_usage, end_managed_usage


@pytest.mark.parametrize("override", [False, True])
def test_real_child_inherits_billing_or_rejects_uncredentialed_override(managed_gateway, override):
    from tools.delegate_tool import _build_child_agent

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    srv._start_agent_build(sid, srv._sessions[sid])
    assert srv._sessions[sid]["agent_ready"].wait(20)
    parent = srv._sessions[sid]["agent"]
    parent._ensure_db_session()
    token = begin_managed_usage(parent)
    try:
        kwargs = dict(task_index=0, goal="Read the fixture file", context=None, toolsets=["file"],
                      model=None, max_iterations=4, task_count=1, parent_agent=parent)
        if override:
            with pytest.raises(ValueError, match="managed"):
                _build_child_agent(**kwargs, override_base_url="http://127.0.0.1:9/v1")
            assert not f.requests
        else:
            child = _build_child_agent(**kwargs)
            try:
                result = child.run_conversation("Read the fixture file")
                assert result["final_response"] == "Local model finished."
                assert all(h.get("X-Aino-Purpose") == "delegation" for h in f.request_headers)
                assert child._fallback_chain == []
            finally:
                child.close()
    finally:
        end_managed_usage(token)
