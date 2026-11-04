"""Explicit native pixel requests survive Aino's tool, lease, and Images wire paths."""

import base64
from email import policy
from email.parser import BytesParser
import io
import json
from pathlib import Path

import httpx
from PIL import Image
import pytest

from tests.plugins.image_gen import test_aino_provider as existing
from tests.plugins.image_gen.test_aino_editing import install_transport


@pytest.fixture
def size_rig(tmp_path, monkeypatch):
    yield from existing.rig.__wrapped__(tmp_path, monkeypatch)


def image_bytes(dimensions, format="PNG"):
    with Image.new("RGB", dimensions, "blue") as image:
        output = io.BytesIO()
        image.save(output, format=format)
        return output.getvalue()


@pytest.mark.parametrize("size,editing", [("2048x3072", False), ("3840x2160", True)])
def test_native_size_reaches_generation_and_reference_edit(size_rig, monkeypatch, size, editing):
    from tools.image_generation_tool import _build_dynamic_image_schema, _handle_image_generate

    original = image_bytes(tuple(map(int, size.split("x"))))
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(original).decode()}]})

    install_transport(monkeypatch, serve)
    provider = existing.plugin()
    monkeypatch.setattr("tools.image_generation_tool._get_plugin_provider", lambda *_a, **_k: provider)
    size_rig.binding.capabilities["image_quality_options"] = ["auto", "high"]
    # Agents build schemas before the execution-only image lease is installed.
    with existing.image_scope(None):
        schema = _build_dynamic_image_schema()
    assert "size" in schema["parameters"]["properties"]
    args = {"prompt": "原生尺寸的小花，不要插值放大", "size": size, "aspect_ratio": "square"}
    if editing:
        args["reference_image_urls"] = ["data:image/png;base64," + base64.b64encode(existing.PNG).decode()]
    with existing.image_scope(size_rig.binding):
        result = json.loads(_handle_image_generate(args))

    assert result["success"] is True, result
    assert result["requested_size"] == result["size"] == size
    assert result["actual_size"] == result["pixel_size"] == size
    assert Path(result["image"]).read_bytes() == original
    assert len(requests) == 1
    request = requests[0]
    if editing:
        assert request.url.path == "/v1/images/edits"
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.content)
        fields = {p.get_param("name", header="content-disposition"): p.get_payload(decode=True)
                  for p in message.iter_parts()}
        assert fields["size"].decode() == size
        assert fields["quality"] == b"auto"
        assert fields["image"] == existing.PNG
    else:
        assert request.url.path == "/v1/images/generations"
        assert json.loads(request.content)["size"] == size
        assert json.loads(request.content)["quality"] == "auto"
    assert request.headers["x-aino-purpose"] == "image"
    assert request.headers["x-aino-turn-id"] == size_rig.scope.turn_id
    assert size_rig.scope.calls.snapshot()["calls"][0]["purpose"] == "image"
    assert "image-secret" not in json.dumps(result)


@pytest.mark.parametrize("size", ["2K", "0x2048", "2048x-1", 2048, {}, ""])
def test_invalid_size_is_rejected_before_credentials_or_request(size_rig, monkeypatch, size):
    provider = existing.plugin()

    def unexpected_credentials():
        pytest.fail("An invalid size must not obtain credentials or issue an image request")

    monkeypatch.setattr(provider, "_endpoint", unexpected_credentials)
    with existing.image_scope(None):
        result = provider.generate("一朵花", size=size)
    assert result["success"] is False
    assert result["error_type"] == "invalid_argument"
    assert "WIDTHxHEIGHT" in result["error"]


def test_upstream_size_rejection_is_not_retried_or_downgraded(size_rig, monkeypatch):
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(400, json={"error": {"message": "image-secret unsupported size"}})

    install_transport(monkeypatch, serve)
    with existing.image_scope(size_rig.binding):
        result = existing.plugin().generate("一朵花", size="4096x4096")
    assert result["success"] is False and result["error_type"] == "api_error"
    assert [json.loads(r.content)["size"] for r in requests] == ["4096x4096"]
    assert "尺寸" in result["error"]
    assert "image-secret" not in json.dumps(result)


@pytest.mark.parametrize("original,actual", [
    (existing.PNG, "1x1"), (image_bytes((27, 19), "WEBP"), "27x19"), (b"unreadable image", None)])
def test_reported_dimensions_come_from_unmodified_output(size_rig, monkeypatch, original, actual):
    def serve(_request):
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(original).decode()}]})

    install_transport(monkeypatch, serve)
    with existing.image_scope(size_rig.binding):
        result = existing.plugin().generate("一朵花", size="2048x2048")
    assert result["success"] is True
    assert Path(result["image"]).read_bytes() == original
    assert result["requested_size"] == "2048x2048"
    assert result["actual_size"] == result["pixel_size"] == actual
    assert result["size_note"]


@pytest.mark.parametrize("explicit,expected", [(None, "1024x1536"), ("auto", "auto")])
def test_default_and_auto_sizes_keep_existing_quality(size_rig, monkeypatch, explicit, expected):
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(existing.PNG).decode()}]})

    install_transport(monkeypatch, serve)
    with existing.image_scope(size_rig.binding):
        result = existing.plugin().generate("一朵花", "portrait", size=explicit)
    assert json.loads(requests[0].content)["size"] == expected
    assert "quality" not in json.loads(requests[0].content)
    assert result["actual_size"] == "1x1"
