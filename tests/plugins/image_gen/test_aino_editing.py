"""Aino sends actual source pixels through its existing managed image executor."""

import base64
from email import policy
from email.parser import BytesParser
import json
from pathlib import Path

import httpx
import pytest

from tests.plugins.image_gen import test_aino_provider as existing


@pytest.fixture
def edit_rig(tmp_path, monkeypatch):
    yield from existing.rig.__wrapped__(tmp_path, monkeypatch)


def install_transport(monkeypatch, serve):
    monkeypatch.setattr(
        "agent.process_bootstrap.build_keepalive_http_client",
        lambda *_a, **_k: httpx.Client(transport=httpx.MockTransport(serve)),
    )


@pytest.mark.parametrize("reference_only", [False, True])
def test_generated_image_is_reused_as_edit_source(edit_rig, monkeypatch, reference_only):
    from tools.image_generation_tool import _build_dynamic_image_schema, _handle_image_generate

    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(existing.PNG).decode()}]})

    install_transport(monkeypatch, serve)
    provider = existing.plugin()
    monkeypatch.setattr("tools.image_generation_tool._get_plugin_provider", lambda *_a, **_k: provider)
    with existing.image_scope(edit_rig.binding):
        original = json.loads(_handle_image_generate({"prompt": "一朵黄色小花"}))
        source = original["image"]
        args = {"prompt": "保留小花，给背景加上蓝天", "aspect_ratio": "square"}
        args.update({"reference_image_urls": [source]} if reference_only else {"image_url": source})
        edited = json.loads(_handle_image_generate(args))
        schema = _build_dynamic_image_schema()

    assert edited["success"] is True, edited
    assert edited["modality"] == "image"
    assert Path(edited["image"]).read_bytes() == existing.PNG
    assert "image_url" in schema["parameters"]["properties"]
    assert "reference_image_urls" in schema["parameters"]["properties"]
    assert [r.url.path for r in requests] == ["/v1/images/generations", "/v1/images/edits"]
    request = requests[1]
    assert request.headers["authorization"] == "Bearer image-secret"
    assert request.headers["x-aino-purpose"] == "image"
    assert request.headers["x-aino-turn-id"] == edit_rig.scope.turn_id
    message = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.content)
    fields = {p.get_param("name", header="content-disposition"): p for p in message.iter_parts()}
    assert fields["model"].get_payload(decode=True) == b"upstream-image"
    assert fields["prompt"].get_payload(decode=True).decode() == args["prompt"]
    assert fields["image"].get_payload(decode=True) == Path(source).read_bytes()
    assert fields["size"].get_payload(decode=True) == b"1024x1024"
    assert all(call["purpose"] == "image" for call in edit_rig.scope.calls.snapshot()["calls"])
    assert "image-secret" not in json.dumps(edited)


def test_edit_failure_does_not_fall_back_to_regeneration(edit_rig, monkeypatch):
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(400, json={"error": {"message": "image-secret unsupported image input"}})

    install_transport(monkeypatch, serve)
    source = "data:image/png;base64," + base64.b64encode(existing.PNG).decode()
    with existing.image_scope(edit_rig.binding):
        result = existing.plugin().generate("修改背景", image_url=source)

    assert result["success"] is False
    assert result["error_type"] == "api_error"
    assert [r.url.path for r in requests] == ["/v1/images/edits"]
    assert "image-secret" not in json.dumps(result)
