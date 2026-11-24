"""Unstarted/failed turns use the same closed worker serialization as normal results."""
import pytest

from agent.managed_worker import accept_result, result_frame


@pytest.mark.parametrize("flag", ["interrupted", "failed"])
def test_worker_frame_serializes_no_reply_for_stopped_or_failed_turn(flag):
    source = {"final_response": None, flag: True, "completed": False, "api_calls": 0}
    frame = result_frame(source)
    accepted, _usage = accept_result(frame)
    assert accepted["final_response"] == "" and accepted[flag] is True
    assert source["final_response"] is None


def test_worker_frame_does_not_silently_accept_missing_successful_reply():
    with pytest.raises(ValueError, match="invalid_worker_result"):
        accept_result(result_frame({"final_response": None, "completed": True}))
