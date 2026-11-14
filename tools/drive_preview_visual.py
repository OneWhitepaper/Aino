"""Validation and image-result adaptation for the existing desktop preview tool."""

from __future__ import annotations

import base64
import binascii
from io import BytesIO
import json
import math
from typing import Any

from tools.browser_vault_preview import redact_preview_result
from tools.desktop_ui import passthrough_json
from tools.registry import tool_error

_PNG_PREFIX = "data:image/png;base64,"
_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_MAX_IMAGE_SIDE = 16_384
_MAX_IMAGE_PIXELS = 64 * 1024 * 1024
_VISUAL_TARGET_ACTIONS = frozenset({"click", "double_click", "hover", "type", "press", "drag"})
_METADATA_LENGTHS = {"tab_id": 256, "observation_id": 256, "url": 8192, "title": 4096}
_RECEIPT_FIELDS = ("acted", "delta", "elements", "note", "point", "tag", "typable", "file_chooser")
_OMITTED_NOTE = (
    "Screenshot image omitted because the current model/API does not accept image tool results. "
    "Use the semantic element inventory or a vision-capable model. Do not guess coordinates."
)
_VERIFICATION_UNAVAILABLE_NOTE = (
    "The browser action completed, but its verification screenshot was invalid or oversized. "
    "Do not repeat the action. Observe the page again with elements or screenshot before "
    "continuing, and do not guess coordinates."
)


def _point(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple)) and len(value) == 2
        and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                and math.isfinite(v) and v >= 0 for v in value)
    )


def validate_visual_action(action: dict[str, Any]) -> str | None:
    """Validate coordinates before crossing the renderer boundary; it verifies observation freshness."""
    for name in ("tab_id", "observation_id", "chooser_id", "dialog_id", "download_id"):
        value = action.get(name)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 256):
            return f"{name} must be a nonempty string of at most 256 characters."
    if action.get("sensitive") is not None and not isinstance(action["sensitive"], bool):
        return "sensitive must be a boolean; it requests confirmation and never grants approval."
    for name in ("coordinate", "to_coordinate"):
        if action.get(name) is not None and not _point(action[name]):
            return f"{name} must contain two finite, nonnegative screenshot pixel coordinates."
    coordinate = action.get("coordinate")
    if action.get("chooser_id") is not None:
        if action["action"] != "upload_files" or action.get("ref") or action.get("selector") or coordinate is not None:
            return "chooser_id is only available for upload_files and replaces ref, selector or coordinates."
    if coordinate is not None:
        if action["action"] not in _VISUAL_TARGET_ACTIONS:
            return "coordinate is only available for click, double_click, hover, type, press and drag."
        if action.get("ref") or action.get("selector"):
            return "Choose either a semantic target or screenshot coordinates, not both."
        if not action.get("tab_id") or not action.get("observation_id"):
            return "Screenshot coordinates require tab_id and observation_id from a screenshot."
    if action.get("observation_id") and not action.get("tab_id"):
        return "observation_id requires the screenshot's tab_id."
    if action["action"] == "drag":
        if coordinate is None or action.get("to_coordinate") is None:
            return "drag requires coordinate and to_coordinate from the same screenshot observation."
    elif action.get("to_coordinate") is not None:
        return "to_coordinate is only available for drag."
    return None


def _dimension(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 < value <= _MAX_IMAGE_SIDE


def _validate_screenshot_metadata(result: dict[str, Any]) -> dict[str, Any]:
    for name, limit in _METADATA_LENGTHS.items():
        value = result.get(name)
        if not isinstance(value, str) or len(value) > limit or (name != "title" and not value.strip()):
            raise ValueError(f"invalid {name}")
    viewport = result.get("viewport")
    if not isinstance(viewport, dict) or not all(_dimension(viewport.get(k)) for k in ("width", "height")):
        raise ValueError("invalid viewport")
    return {key: viewport[key] for key in ("width", "height")}


def _validated_png(image: Any) -> str:
    from agent.image_eviction_policy import image_dimensions_from_bytes
    from PIL import Image

    if not isinstance(image, dict):
        raise ValueError("missing image")
    width, height = image.get("width"), image.get("height")
    if not (_dimension(width) and _dimension(height)) or width * height > _MAX_IMAGE_PIXELS:
        raise ValueError("invalid image dimensions")
    data_url = image.get("data_url")
    if not isinstance(data_url, str) or not data_url.startswith(_PNG_PREFIX):
        raise ValueError("image is not a PNG data URL")
    encoded = data_url[len(_PNG_PREFIX):]
    if len(encoded) > ((_MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ValueError("image exceeds the byte limit")
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > _MAX_IMAGE_BYTES or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("invalid PNG image")
    if image_dimensions_from_bytes(raw) != (width, height):
        raise ValueError("image dimensions do not match its pixels")
    with Image.open(BytesIO(raw)) as decoded:
        if decoded.format != "PNG":
            raise ValueError("invalid PNG format")
        decoded.verify()
    return data_url


def _verification_unavailable(result: dict[str, Any]) -> str:
    """An unavailable follow-up image must never turn a completed mutation into a retryable failure."""
    metadata = {key: result[key] for key in _RECEIPT_FIELDS if key in result}
    for key in ("tab_id", "url", "title"):
        value = result.get(key)
        if isinstance(value, str) and len(value) <= _METADATA_LENGTHS[key]:
            metadata[key] = value
    note = metadata.get("note")
    metadata.update(success=True, image_omitted=True,
                    note="\n".join(filter(None, (note if isinstance(note, str) else None,
                                               _VERIFICATION_UNAVAILABLE_NOTE))))
    text = json.dumps(metadata, ensure_ascii=False)
    image = result.get("image")
    data_url = image.get("data_url") if isinstance(image, dict) else None
    if isinstance(data_url, str) and data_url:
        text = text.replace(data_url, "[screenshot pixels omitted]")
    return redact_preview_result(text)


def preview_visual_result(raw: str, screenshot_required: bool = False) -> str | dict[str, Any]:
    """Adapt image-bearing action receipts, preserving semantic results and never serializing pixels as text."""
    try:
        result = json.loads(raw)
    except (ValueError, TypeError):
        if not screenshot_required:
            return redact_preview_result(passthrough_json(raw))
        return tool_error("The browser returned an invalid screenshot. Capture the page again.", success=False)
    try:
        if not isinstance(result, dict) or "image" not in result:
            if screenshot_required and (not isinstance(result, dict) or result.get("success") is not False):
                raise ValueError("missing screenshot image")
            return redact_preview_result(passthrough_json(raw))
        if result.get("success") is not True:
            return redact_preview_result(tool_error(result.get("error") or "Screenshot capture failed.", success=False))
        viewport = _validate_screenshot_metadata(result)
        data_url = _validated_png(result.get("image"))
    except (ValueError, TypeError, OSError, binascii.Error):
        if not screenshot_required and isinstance(result, dict) and result.get("success") is True:
            return _verification_unavailable(result)
        return tool_error("The browser returned an invalid or oversized screenshot. Capture the page again.", success=False)

    metadata = {key: result[key] for key in ("success", "tab_id", "observation_id", "url", "title")}
    metadata.update({key: result[key] for key in _RECEIPT_FIELDS if key in result})
    metadata["viewport"] = {key: viewport[key] for key in ("width", "height")}
    metadata["image"] = {key: result["image"][key] for key in ("width", "height")}
    text = redact_preview_result(json.dumps(metadata, ensure_ascii=False).replace(data_url, "[screenshot pixels omitted]"))
    from tools.vision_tools import _should_use_native_vision_fast_path

    if not _should_use_native_vision_fast_path():
        fallback = json.loads(text)
        fallback.update(image_omitted=True, note="\n".join(filter(None, (fallback.get("note"), _OMITTED_NOTE))))
        return json.dumps(fallback, ensure_ascii=False)
    return {
        "_multimodal": True,
        "content": [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": data_url}}],
        "text_summary": text + "\n\n" + _OMITTED_NOTE,
        "meta": json.loads(text),
    }
