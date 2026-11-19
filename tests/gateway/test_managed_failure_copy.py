"""Messaging failures must preserve uncertainty about an accepted model operation."""

import pytest

from agent.managed_inference_errors import ManagedOperationUnknown
from gateway.run import GatewayRunner


@pytest.mark.parametrize("partial", ["", "A partial answer."])
def test_uncertain_request_never_claims_it_was_unprocessed(partial):
    runner = object.__new__(GatewayRunner)
    error = str(ManagedOperationUnknown())
    result = {"failure_reason": "managed_operation_unknown", "error": error,
              "messages": [{"role": "user", "content": "fixture"}]}
    notice = runner._hmwa_failed_turn_notice(result)
    reply = runner._hmwa_add_failed_turn_notice(partial or error, notice)
    assert reply == (partial + "\n\n" + error if partial else error)
    assert "not processed" not in reply
