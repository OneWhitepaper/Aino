"""Gateway fallback writes keep text-vision context without inventing native API payloads."""
from copy import deepcopy

import pytest

from agent.api_content import effective_message_content
from gateway.config import GatewayConfig, Platform
from gateway.platforms.event import MessageEvent, MessageType
from gateway.run import GatewayRunner
from gateway.session import SessionSource, SessionStore


@pytest.mark.asyncio
@pytest.mark.parametrize('failed', [True, False], ids=['provider-failure', 'empty-result'])
async def test_gateway_fallback_keeps_image_analysis_for_replay(tmp_path, failed):
    """A runtime without its own transcript writer must not lose the analyzed image on retry."""
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    runner = object.__new__(GatewayRunner)
    runner.session_store, runner._session_db = store, None

    async def refresh(*_args):
        return None

    runner._refresh_agent_cache_message_count = refresh
    source = SessionSource(platform=Platform.LOCAL, chat_id='image-fallback', user_id='owner')
    entry = store.get_or_create_session(source)
    db = store._db_for_session_id(entry.session_id)
    image = tmp_path / 'image.png'
    image.write_bytes(b'unchanged image bytes')
    event = MessageEvent(text='change 350 to 400', source=source, message_id='input-1',
                         message_type=MessageType.PHOTO, media_urls=[str(image)], media_types=['image/png'])
    event._gateway_image_text_enriched = True
    clean = f'change 350 to 400\n@image:{image}'
    model_input = f'[The user sent an image~ Two transfer cards show 350]\n[image_url: {image}]\n\nchange 350 to 400'
    prepared = runner._PreparedTurn([], '', model_input, clean, None, None, entry.session_id, 'owner-1')
    before = deepcopy(prepared)
    try:
        await runner._hmwa_persist_turn_transcript(
            event=event, source=source, session_entry=entry, session_key=entry.session_key,
            agent_result={'agent_persisted': False, 'failed': failed, 'error': '429' if failed else None},
            agent_messages=[], prepared=prepared, response='' if failed else 'done',
            agent_failed_early=failed, hidden_reasoning_incomplete=False, is_context_overflow_failure=False)
        rows = db.get_messages(entry.session_id)
        assert rows[0]['content'] == clean
        assert rows[0]['api_content'] == model_input
        replay = store.load_transcript(entry.session_id)
        assert effective_message_content(replay[0]) == model_input
        assert prepared == before
        assert image.read_bytes() == b'unchanged image bytes'
    finally:
        db.close()


@pytest.mark.parametrize('image', [True, False], ids=['native-image', 'plain-text'])
def test_gateway_fallback_does_not_invent_wire_content_without_vision_enrichment(tmp_path, image):
    """Native pixels are attached later; the pre-run caption is not their API replay payload."""
    source = SessionSource(platform=Platform.LOCAL, chat_id='native-fallback')
    event = MessageEvent(text='caption', source=source)
    event._gateway_image_text_enriched = False
    clean = f'caption\n@image:{tmp_path / "image.png"}' if image else 'caption'
    prepared = GatewayRunner._PreparedTurn([], '', 'caption', clean, None, None)
    row = GatewayRunner._hmwa_user_transcript_entry(event, prepared, 0)
    assert row['content'] == clean
    assert 'api_content' not in row
