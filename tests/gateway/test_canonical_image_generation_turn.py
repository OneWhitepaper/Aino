"""Real canonical admission fences a bound image tool and its billing receipt."""

import base64
from contextvars import copy_context
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call


@pytest.mark.asyncio
async def test_claimed_image_turn_materializes_and_old_generation_cannot_spend(tmp_path, monkeypatch):
    from gateway.run import GatewayRunner, _profile_runtime_scope
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from plugins.image_gen.aino import AinoImageGenProvider
    from tests.plugins.image_gen.test_aino_provider import PNG
    from agent.managed_image_provider import current_image_binding
    from tui_gateway.managed_image_runtime import conversation_image_scope
    from tui_gateway.managed_model_usage import begin_managed_usage, current_usage_metadata, end_managed_usage

    home = tmp_path / "profile"
    home.mkdir()
    (home / "config.yaml").write_text(json.dumps({
        "model": {"provider": "custom", "default": "chat", "base_url": "http://127.0.0.1:1/v1"},
        "image_gen": {"provider": "aino", "model": "image-catalog"}}))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id="image-turn")
    viewer = AuthorityConnection(authority, Peer(), {"provider": "local", "user_id": "owner"}, operator=True)
    controller = AuthorityConnection(authority, Peer(), {"provider": "local", "user_id": "owner"}, operator=True)
    requests, results, captured = [], [], []
    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client",
                        lambda *_a, **_k: httpx.Client(transport=httpx.MockTransport(serve)))

    async def execute(auth, ref, row):
        assert auth.executing[ref.session_id] == row["generation"]
        if captured:
            assert captured[0].run(current_image_binding) is None
        billing = begin_managed_usage(SimpleNamespace(api_key="byok-chat-key", session_id=ref.session_id))
        try:
            with _profile_runtime_scope(home), conversation_image_scope(owner=(auth, ref.session_id, row["generation"])):
                generated = AinoImageGenProvider().generate("一只橙色的小猫", "square")
                assert generated["success"], generated
                results.append((generated, current_usage_metadata()))
                captured.append(copy_context())
        finally:
            end_managed_usage(billing)
        return "image complete"
    monkeypatch.setattr("gateway.session_finite.execute_finite_admission", execute)
    try:
        created = await call(viewer, "session.create", request_id="image-create", source="gui",
                             cwd=str(tmp_path), toolsets=[], model="chat", provider="custom",
                             base_url="http://127.0.0.1:1/v1", api_key="byok-chat-key")
        assert "result" in created, created
        sid = created["result"]["session_id"]
        params = {"session_id": sid, "purpose": "image", "model_id": "image-catalog",
                  "owner": {"platform_origin": "https://image.invalid", "user_id": "account"}}
        ticket = await call(viewer, "session.managed_model_ticket", **params)
        claim = await call(controller, "session.claim_managed_model", **params,
                           session_ticket=ticket["result"]["session_ticket"])
        bound = await call(controller, "session.bind_managed_model", **params,
                           binding_revision=claim["result"]["binding_revision"],
                           model="image-wire", api_mode="images_generations",
                           capabilities={"tools": False, "vision": False, "reasoning": False, "image_generation": True},
                           credential_id="image-credential", api_key="image-secret",
                           base_url="https://image.invalid/v1",
                           expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat())
        assert bound.get("result", {}).get("bound"), bound
        for i in range(2):
            admitted = await call(viewer, "prompt.submit", session_id=sid, text="生成图片", submission_id=f"image-{i}")
            assert "result" in admitted, admitted
            await authority.sessions[sid].task
            assert captured[0].run(current_image_binding) is None
        assert len(requests) == 2
        assert all(request.headers["authorization"] == "Bearer image-secret" for request in requests)
        assert all(Path(result["image"]).read_bytes() == PNG for result, _ in results)
        assert all(metadata["billing"]["calls"][0]["purpose"] == "image" for _, metadata in results)
        assert not authority.executing
    finally:
        await viewer.close()
        await controller.close()
        authority.db.close()
