"""Human browser approval must outlive the page-read and availability-probe deadlines."""

import json

import pytest

from tui_gateway import server, server_requests


@pytest.fixture
def delayed_browser_reply(monkeypatch):
    """Exercise real request registration/settlement with a simulated 90-second reviewer."""
    frames = []
    cancellations = []
    waits = []

    class ReviewWait:
        def __init__(self, frame):
            self.frame = frame

        def wait(self, timeout):
            waits.append(timeout)
            if timeout is None or timeout >= 90:
                server_requests.resolve_response({
                    "id": self.frame["id"],
                    "result": {"value": json.dumps({"success": True})},
                })

        def set(self):
            pass

    def write(frame):
        frames.append(frame)
        server_requests._open[frame["id"]].event = ReviewWait(frame)

    monkeypatch.setattr(server_requests, "_write", write)
    monkeypatch.setattr(server_requests, "_answerable", lambda sid: True)
    monkeypatch.setattr(server_requests, "_emit", lambda *event: cancellations.append(event))
    server_requests.reset_for_tests()
    yield frames, cancellations, waits
    server_requests.reset_for_tests()


@pytest.mark.parametrize("bridge_state", [None, "answered"])
def test_browser_action_allows_human_review_even_before_first_bridge_answer(monkeypatch, delayed_browser_reply, bridge_state):
    sid = "browser-review"
    monkeypatch.setitem(server._sessions, sid, {"preview_action_bridge": bridge_state})

    result = server._agent_cbs(sid)["drive_preview_callback"]({"action": "click", "ref": "btn-pay"})

    assert json.loads(result) == {"success": True}
    frames, cancellations, waits = delayed_browser_reply
    assert frames[0]["method"] == "preview.act"
    assert waits[0] >= 90
    assert cancellations == []
    assert server_requests.open_requests(sid) == []


def test_preview_reads_keep_the_short_deadline_and_reject_late_answers(delayed_browser_reply):
    sid = "browser-read"

    result = server._agent_cbs(sid)["read_preview_callback"]()

    frames, cancellations, waits = delayed_browser_reply
    assert result == ""
    assert frames[0]["method"] == "preview.read"
    assert waits[0] < 90
    assert cancellations == [("request.cancel", sid, {
        "id": frames[0]["id"], "method": "preview.read", "reason": "timeout",
    })]
    assert not server_requests.resolve_response({"id": frames[0]["id"], "result": {"value": "late"}})
    assert server_requests.open_requests(sid) == []
