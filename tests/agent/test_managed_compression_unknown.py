"""An unknown managed summary outcome preserves context without another paid call."""

from copy import deepcopy
from unittest.mock import patch

import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from agent.context_compressor import ContextCompressor
from agent.managed_inference_errors import ManagedOperationUnknown


@pytest.mark.parametrize("managed_main", [False, True], ids=["managed-aux", "managed-main"])
def test_unknown_summary_outcome_preserves_transcript_through_cooldown(managed_main):
    key = ManagedCredential(
        lambda: "fixture", "owner", "session", "main-model",
        "https://aino.invalid/v1", "chat_completions", False,
        scope=BillingScope("aino", "owner", "session", "turn", "chat"),
    ) if managed_main else "main-key"
    with patch("agent.context_compressor.get_model_context_length", return_value=100000):
        compressor = ContextCompressor(
            model="main-model", api_key=key, summary_model_override="summary-model",
            quiet_mode=True, protect_first_n=2, protect_last_n=2,
            abort_on_summary_failure=False,
        )
    messages = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"retain message {i}"}
        for i in range(12)
    ]
    original = deepcopy(messages)

    with patch("agent.context_compressor.time.monotonic", return_value=1000.0), patch(
        "agent.context_compressor.call_llm", side_effect=ManagedOperationUnknown(),
    ) as call:
        with pytest.raises(ManagedOperationUnknown):
            compressor.compress(messages, current_tokens=999999, force=True)
        second = compressor.compress(messages, current_tokens=999999)

    assert second == messages == original
    assert call.call_count == 1
    assert compressor._last_compress_aborted is True
    assert compressor._last_summary_fallback_used is False
    assert compressor._last_summary_dropped_count == 0
