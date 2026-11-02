"""Managed image edits keep the model and destination fixed before attaching credentials."""

from uuid import uuid4

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential


def credential():
    scope = BillingScope("aino", "user", "session", str(uuid4()), "image")
    return ManagedCredential(lambda: "image-lease", "user", "session", "image-model",
                             "https://aino.invalid/v1", "images_generations", False, scope=scope)


@pytest.mark.parametrize("model_fields", [
    [("model", (None, "image-model"))],
    [("model", (None, "wrong-model"))],
    [("model", (None, "image-model")), ("model", (None, "wrong-model"))],
    [("model", ("model.txt", b"image-model", "text/plain"))],
    [],
])
def test_multipart_edit_checks_unique_authorized_model(model_fields):
    key = credential()
    request = httpx.Request("POST", "https://aino.invalid/v1/images/edits",
                            files=[("image", ("image.png", b"source-pixels", "image/png")), *model_fields])
    allowed = model_fields == [("model", (None, "image-model"))]
    if allowed:
        key.prepare_request(request)
        assert request.headers["authorization"] == "Bearer image-lease"
        assert request.headers["x-aino-purpose"] == "image"
        assert b"source-pixels" in request.read()
        assert len(key.scope.calls.snapshot()["calls"]) == 1
    else:
        with pytest.raises(RuntimeError, match="managed_model_identity_mismatch"):
            key.prepare_request(request)
        assert "authorization" not in request.headers
        assert not key.scope.calls.snapshot()["calls"]


@pytest.mark.parametrize("method,url", [
    ("POST", "https://other.invalid/v1/images/edits"),
    ("POST", "https://aino.invalid/other/images/edits"),
    ("POST", "https://aino.invalid/v1/chat/completions"),
    ("POST", "https://aino.invalid/v1/images/edits/async"),
    ("GET", "https://aino.invalid/v1/images/edits"),
])
def test_image_lease_cannot_send_to_other_routes(method, url):
    request = httpx.Request(method, url, json={"model": "image-model"})
    with pytest.raises(RuntimeError, match="managed_credential_destination_mismatch"):
        credential().prepare_request(request)
    assert "authorization" not in request.headers
