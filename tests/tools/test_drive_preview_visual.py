"""Desktop visual actions keep screenshot pixels separate from text metadata."""

import base64
from io import BytesIO
import json

from PIL import Image
import pytest

from tools import drive_preview_tool
from tools.registry import registry


def screenshot_result(width=4, height=3):
    stream = BytesIO()
    Image.new("RGB", (width, height), "white").save(stream, format="PNG")
    return {
        "success": True,
        "tab_id": "tab-a",
        "observation_id": "observation-a",
        "url": "https://example.test/app",
        "title": "Example",
        "viewport": {"width": width, "height": height},
        "image": {
            "data_url": "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii"),
            "width": width,
            "height": height,
        },
    }


def dispatch(args, callback):
    return registry.dispatch("drive_preview", args, callback=callback)


def test_screenshot_returns_native_image_with_redacted_metadata(monkeypatch):
    from agent.redact import clear_vault_redaction_values, register_vault_redaction_value
    from tools import vision_tools

    monkeypatch.setattr(vision_tools, "_native_tool_result_images", lambda *_: True)
    payload = screenshot_result()
    payload["title"] = "Synthetic registered-secret"
    register_vault_redaction_value("registered-secret")
    seen = []
    try:
        result = dispatch({"action": "screenshot", "tab_id": "tab-a"}, lambda args: seen.append(args) or json.dumps(payload))
    finally:
        clear_vault_redaction_values()

    assert seen == [{"action": "screenshot", "tab_id": "tab-a"}]
    assert result["_multimodal"] is True
    metadata = json.loads(result["content"][0]["text"])
    assert metadata["observation_id"] == "observation-a"
    assert metadata["image"] == {"width": 4, "height": 3}
    assert "registered-secret" not in json.dumps(metadata)
    assert "base64" not in result["content"][0]["text"]
    assert "base64" not in result["text_summary"]
    assert result["content"][1] == {"type": "image_url", "image_url": {"url": payload["image"]["data_url"]}}
    assert "omitted" in result["text_summary"]


def test_screenshot_unsupported_model_returns_text_without_pixels(monkeypatch):
    from tools import vision_tools

    monkeypatch.setattr(vision_tools, "_native_tool_result_images", lambda *_: False)
    payload = screenshot_result()
    result = dispatch({"action": "screenshot"}, lambda _: json.dumps(payload))

    assert isinstance(result, str)
    metadata = json.loads(result)
    assert metadata["image_omitted"] is True
    assert metadata["tab_id"] == "tab-a"
    assert "do not guess coordinates" in metadata["note"].lower()
    assert "base64" not in result


@pytest.mark.parametrize("vision", [True, False])
def test_screenshot_uses_live_managed_model_capability(vision, monkeypatch):
    from agent.auxiliary_billing_scope import ManagedCredential
    from agent.auxiliary_client import scoped_runtime_main
    from hermes_cli import config

    monkeypatch.setattr(config, "load_config", dict)

    def unused_key():
        raise AssertionError("Screenshot routing must not resolve the device key")

    key = ManagedCredential(
        unused_key, "account-a", "session-a", "managed-screenshot-model",
        "https://inference.example.invalid/v1", "chat_completions", vision,
    )
    with scoped_runtime_main({"provider": "aino", "model": key.model, "api_key": key}):
        result = dispatch({"action": "screenshot"}, lambda _: json.dumps(screenshot_result()))

    if vision:
        assert result["_multimodal"] is True
        assert result["content"][1]["type"] == "image_url"
    else:
        assert json.loads(result)["image_omitted"] is True
        assert "base64" not in result


@pytest.mark.parametrize("native", [True, False])
def test_coordinate_action_returns_fresh_image_and_inventory_without_pixels_in_text(monkeypatch, native):
    from tools import vision_tools

    monkeypatch.setattr(vision_tools, "_native_tool_result_images", lambda *_: native)
    payload = screenshot_result()
    payload["acted"] = 'clicked button "Show details"'
    payload["elements"] = [{"ref": "details", "role": "region", "label": "Details", "value": "Ready"}]
    payload["note"] = "The action completed; inspect the new observation."
    args = {"action": "click", "tab_id": "tab-a", "observation_id": "old-observation", "coordinate": [1, 2]}
    result = dispatch(args, lambda _: json.dumps(payload))

    metadata = json.loads(result["content"][0]["text"]) if native else json.loads(result)
    assert metadata["observation_id"] == "observation-a"
    assert metadata["acted"] == payload["acted"]
    assert metadata["elements"] == payload["elements"]
    assert payload["note"] in metadata["note"]
    assert metadata["image"] == {"width": 4, "height": 3}
    assert "base64" not in json.dumps(metadata)
    assert "data_url" not in json.dumps(metadata)
    if native:
        assert result["content"][1]["image_url"]["url"] == payload["image"]["data_url"]
    else:
        assert metadata["image_omitted"] is True


@pytest.mark.parametrize("args", [
    {"action": "click", "ref": "show-details"},
    {"action": "type", "ref": "message", "text": "Send once"},
    {"action": "drag", "coordinate": [1, 2], "to_coordinate": [2, 1],
     "tab_id": "tab-a", "observation_id": "before-action"},
], ids=["click", "type", "drag"])
def test_successful_mutation_keeps_receipt_when_verification_png_is_invalid(args):
    payload = screenshot_result()
    payload["image"]["data_url"] = "data:image/png;base64,aGVsbG8="
    payload["acted"] = args["action"] + " completed"
    payload["elements"] = [{"ref": "receipt", "role": "status", "label": "Sent"}]
    calls = []
    result = json.loads(dispatch(args, lambda request: calls.append(request) or json.dumps(payload)))

    assert len(calls) == 1
    assert result["success"] is True
    assert result["acted"] == payload["acted"]
    assert result["elements"] == payload["elements"]
    assert result["image_omitted"] is True
    assert "do not repeat" in result["note"].lower()
    assert "observe" in result["note"].lower()
    assert "data_url" not in json.dumps(result)
    assert "base64" not in json.dumps(result)


def test_invalid_verification_metadata_keeps_only_safe_action_receipt():
    from agent.redact import clear_vault_redaction_values, register_vault_redaction_value

    payload = screenshot_result()
    payload["acted"] = "typed registered-secret"
    payload["title"] = "x" * 4097
    payload["observation_id"] = "invalid" * 100
    payload["note"] = "Previous verification: " + payload["image"]["data_url"]
    register_vault_redaction_value("registered-secret")
    try:
        result = json.loads(dispatch({"action": "type", "ref": "name", "text": "registered-secret"},
                                     lambda _: json.dumps(payload)))
    finally:
        clear_vault_redaction_values()

    assert result["success"] is True
    assert result["image_omitted"] is True
    assert result["tab_id"] == "tab-a"
    assert "title" not in result
    assert "observation_id" not in result
    assert "registered-secret" not in json.dumps(result)
    assert "base64" not in json.dumps(result)


@pytest.mark.parametrize("invalid", [
    "not-base64", "data:image/jpeg;base64,aGVsbG8=", "data:image/png;base64,aGVsbG8=",
])
def test_screenshot_rejects_invalid_png_without_echoing_pixels(invalid):
    payload = screenshot_result()
    payload["image"]["data_url"] = invalid
    result = json.loads(dispatch({"action": "screenshot"}, lambda _: json.dumps(payload)))
    assert result["success"] is False
    assert "screenshot" in result["error"].lower()
    assert invalid not in json.dumps(result)


def test_screenshot_rejects_mismatched_dimensions():
    payload = screenshot_result()
    payload["image"]["width"] = 300
    result = json.loads(dispatch({"action": "screenshot"}, lambda _: json.dumps(payload)))
    assert result["success"] is False


def test_screenshot_rejects_oversized_pixels_before_embedding(monkeypatch):
    from tools import drive_preview_visual

    monkeypatch.setattr(drive_preview_visual, "_MAX_IMAGE_BYTES", 32)
    payload = screenshot_result()
    result = json.loads(dispatch({"action": "screenshot"}, lambda _: json.dumps(payload)))
    assert result["success"] is False
    assert "data_url" not in json.dumps(result)


@pytest.mark.parametrize("field,value", [
    ("tab_id", ""), ("observation_id", "x" * 257), ("url", "https://example.test/" + "a" * 8192),
], ids=["missing-tab", "oversized-observation", "oversized-url"])
def test_screenshot_requires_bounded_target_metadata(field, value):
    payload = screenshot_result()
    payload[field] = value
    result = json.loads(dispatch({"action": "screenshot"}, lambda _: json.dumps(payload)))
    assert result["success"] is False


def test_coordinate_click_and_drag_forward_observation_and_sensitivity():
    seen = []
    base = {"tab_id": "tab-a", "observation_id": "observation-a", "coordinate": [12.5, 21]}
    callback = lambda args: seen.append(args) or json.dumps({"success": True})
    result = dispatch({"action": "click", **base, "sensitive": True}, callback)
    assert json.loads(result)["success"] is True
    assert seen[-1] == {"action": "click", **base, "sensitive": True}
    result = dispatch({"action": "drag", **base, "to_coordinate": [40, 60]}, callback)
    assert json.loads(result)["success"] is True
    assert seen[-1] == {"action": "drag", **base, "to_coordinate": [40, 60]}


@pytest.mark.parametrize("args", [
    {"action": "click", "coordinate": [1, 2]},
    {"action": "click", "coordinate": [1, 2], "tab_id": "tab-a"},
    {"action": "click", "coordinate": [1, float("nan")], "tab_id": "tab-a", "observation_id": "o"},
    {"action": "click", "coordinate": [True, 2], "tab_id": "tab-a", "observation_id": "o"},
    {"action": "click", "coordinate": [-1, 2], "tab_id": "tab-a", "observation_id": "o"},
    {"action": "drag", "coordinate": [1, 2], "tab_id": "tab-a", "observation_id": "o"},
    {"action": "click", "ref": "button-a", "sensitive": "false"},
])
def test_invalid_visual_targets_never_reach_the_browser(args):
    seen = []
    result = json.loads(dispatch(args, lambda payload: seen.append(payload) or "{}"))
    assert "error" in result
    assert seen == []
