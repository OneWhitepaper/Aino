"""Real backend discovery reaches the managed image policy and existing edit executor."""

import base64
import json
from email import policy
from email.parser import BytesParser

import httpx
import pytest

from tests.plugins.image_gen import test_aino_provider as existing


@pytest.fixture
def rig(tmp_path, monkeypatch):
    yield from existing.rig.__wrapped__(tmp_path, monkeypatch)


def test_discovered_aino_backend_keeps_managed_generation_and_edit_requests(rig, monkeypatch):
    from tools.image_generation_tool import _get_plugin_provider, _handle_image_generate

    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(existing.PNG).decode()}]})

    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client",
                        lambda *_a, **_k: httpx.Client(transport=httpx.MockTransport(serve)))
    provider = _get_plugin_provider("aino", force=True)
    assert provider is not None and provider.is_available()
    rig.binding.credential_type = "device"
    rig.binding.credential_version = 3
    rig.binding.expires_at = None
    with existing.image_scope(rig.binding):
        generated = json.loads(_handle_image_generate({"prompt": "A blue flower"}))
        rig.binding.api_key = "renewed-secret"
        rig.binding.credential_version = 4
        edited = json.loads(_handle_image_generate({
            "prompt": "Make this flower red", "image_url": "data:image/png;base64," + base64.b64encode(existing.PNG).decode(),
        }))
    assert generated["success"] and edited["success"]
    assert [request.url.path for request in requests] == ["/v1/images/generations", "/v1/images/edits"]
    assert {request.headers["x-aino-model-id"] for request in requests} == {"image-catalog-id"}
    assert {request.headers["x-aino-turn-id"] for request in requests} == {rig.scope.turn_id}
    assert [request.headers["authorization"] for request in requests] == ["Bearer image-secret", "Bearer renewed-secret"]
    assert [request.extensions["aino_managed_credential_version"] for request in requests] == [3, 4]
    assert len({request.headers["x-aino-operation-id"] for request in requests}) == 2
    assert len(rig.scope.calls.snapshot()["calls"]) == 2
    edit = requests[1]
    multipart = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + edit.headers["content-type"].encode() + b"\r\n\r\n" + edit.content)
    fields = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True)
              for part in multipart.iter_parts()}
    assert fields["image"] == existing.PNG
    assert fields["model"] == b"upstream-image"
    assert "image-secret" not in json.dumps([generated, edited])
    assert "renewed-secret" not in json.dumps([generated, edited])
