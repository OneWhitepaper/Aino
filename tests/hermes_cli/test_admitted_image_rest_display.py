"""Desktop REST hydration gets image display refs while physical and API content stay exact."""
import pytest

from tests.gateway.test_admitted_image_display import _image_turn


@pytest.mark.asyncio
async def test_rest_image_display_uses_the_same_admitted_turn_as_gateway_history(tmp_path, monkeypatch):
    from agent.context_references import format_reference_value
    from hermes_cli.web_routers import sessions

    db, image, enriched = _image_turn(tmp_path, monkeypatch)
    try:
        rows = db.get_messages('s')
        monkeypatch.setattr(sessions, '_with_db', lambda profile, read, **kwargs: read(db))
        result = await sessions.get_session_messages(
            's', limit=100, offset=0, order='oldest', include_compacted=False, inline_images=False)
        projected = result['messages']
        assert projected[0]['display_content'] == f'把350改成400\n@image:{format_reference_value(image)}'
        assert projected[0]['content'] == enriched
        assert projected[0]['api_content'] == enriched
        assert 'display_content' not in rows[0]
    finally:
        db.close()
