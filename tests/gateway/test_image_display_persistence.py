"""Attached pixels and authored captions survive vision preprocessing and turn recovery."""
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from gateway.config import GatewayConfig, Platform
from gateway.platforms.event import MessageEvent, MessageType
from gateway.run import GatewayRunner
from gateway.run_turn_runner import TurnRunner
from gateway.session import SessionSource
from gateway.turn_context import TurnContext
from hermes_state import SessionDB
from run_agent import AIAgent
from tests.gateway.test_local_viewer_events_submit import _gateway_runner, _RecordingAgent


PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d494844520000000100000001080600000'
    '01f15c4890000000a49444154789c6360000002000100ffff0300000600'
    '0557bfabd40000000049454e44ae426082')


def _flush(db, message, override):
    agent = AIAgent.__new__(AIAgent)
    agent._session_db, agent._session_db_created = db, True
    agent.session_id, agent._last_flushed_db_idx = 'sid', 0
    agent._persist_disabled = False
    agent._persist_user_message_idx = 0
    agent._persist_user_message_override = override
    agent._flush_messages_to_session_db([{'role': 'user', 'content': message}], [])
    return db.get_messages('sid')[0]


def _context(message, override, history=None):
    return TurnContext(
        source=SessionSource(platform=Platform.LOCAL, chat_id='local-chat'), message=message,
        history=history or [], session_id='sid', session_key='key', user_config={},
        persist_user_message=override, AIAgent=_RecordingAgent,
        resolve_display_setting=lambda *_: False, _run_still_current=lambda: True,
        _hooks_ref=SimpleNamespace(loaded_hooks=False))


@pytest.mark.asyncio
@pytest.mark.parametrize('caption', ['请看这两张图', ''])
async def test_vision_description_stays_in_api_sidecar_not_authored_row(tmp_path, monkeypatch, caption):
    runner = object.__new__(GatewayRunner)
    runner.config, runner.adapters = GatewayConfig(), {}
    runner._decide_image_input_mode = lambda **_: 'text'
    runner._resolve_session_agent_runtime = lambda **_: ('fixture', {'provider': 'custom'})
    # Only the external vision call is substituted: real inbound enrichment, timestamping and flush.
    monkeypatch.setattr('tools.vision_tools.vision_analyze_tool', AsyncMock(return_value='{"success":true,"analysis":"VISION-ONLY-DESCRIPTION"}'))
    images = [tmp_path / 'first picture.png', tmp_path / 'second.png']
    for image in images:
        image.write_bytes(PNG)
    event = MessageEvent(
        text=caption, source=SessionSource(platform=Platform.LOCAL, chat_id='local-chat'),
        message_type=MessageType.PHOTO, media_urls=list(map(str, images)), media_types=['image/png'] * 2)
    message = await runner._prepare_inbound_message_text(event=event, source=event.source, history=[], session_key='key')
    message, override, _ = runner._hmwa_apply_message_timestamp(event, message)
    assert 'VISION-ONLY-DESCRIPTION' in message
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        db.create_session('sid', source='local')
        row = _flush(db, message, override)
        assert row['content'] == (caption + '\n' if caption else '') + f'@image:`{images[0]}`\n@image:{images[1]}'
        assert row['api_content'] == message


@pytest.mark.asyncio
async def test_queued_image_persists_the_same_clean_caption(tmp_path):
    image = tmp_path / 'queued.png'
    image.write_bytes(PNG)
    runner = object.__new__(GatewayRunner)
    runner.config, runner.adapters = GatewayConfig(), {}
    runner._MAX_INTERRUPT_DEPTH = 8
    runner._run_agent = AsyncMock(return_value={'final_response': 'done', 'messages': []})
    runner._run_agent_deliver_first_response = AsyncMock()
    runner._is_goal_continuation_event = MagicMock(return_value=False)
    runner._session_key_for_source = lambda _: 'key'
    runner._decide_image_input_mode = lambda **_: 'text'
    runner._enrich_message_with_vision = AsyncMock(return_value='VISION-ONLY-DESCRIPTION\ncaption')
    runner._resolve_session_agent_runtime = lambda **_: ('fixture', {'provider': 'custom'})
    runner._reply_anchor_for_event = lambda _: None
    runner._delivery_adapter_for = lambda _: None
    runner._refresh_agent_cache_message_count = AsyncMock()
    source = SessionSource(platform=Platform.LOCAL, chat_id='local-chat')
    event = MessageEvent(text='caption', source=source, message_type=MessageType.PHOTO,
                         media_urls=[str(image)], media_types=['image/png'])
    ctx = SimpleNamespace(source=source, session_id='sid', session_key='key', run_generation=1,
                          _interrupt_depth=0, history=[], _status_thread_metadata=None,
                          context_prompt=None, result_holder=[None])
    await runner._run_agent_queued_followup(
        ctx, adapter=None, pending='caption', pending_event=event, response='resp',
        result={'interrupted': True, 'messages': []}, stream_task=None)
    call = runner._run_agent.await_args.kwargs
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        db.create_session('sid', source='local')
        row = _flush(db, call['message'], call['persist_user_message'])
        assert row['content'] == f'caption\n@image:{image}'
        assert row['api_content'] == 'VISION-ONLY-DESCRIPTION\ncaption'


@pytest.mark.parametrize('recovery', ['none', 'interrupted', 'resume'])
def test_native_pixels_and_clean_display_survive_recovery(tmp_path, recovery):
    image = tmp_path / 'native.png'
    image.write_bytes(PNG)
    clean = f'caption\n@image:{image}'
    history = [{'role': 'tool', 'content': 'pending', 'timestamp': time.time()}] if recovery == 'interrupted' else []
    runner = _gateway_runner()
    runner._consume_pending_native_image_paths.return_value = [str(image)]
    if recovery == 'resume':
        runner.session_store._entries = {'key': SimpleNamespace(
            resume_pending=True, resume_reason='restart_timeout', last_resume_marked_at=time.time())}
    ctx = _context('caption', clean, history)
    TurnRunner(runner, ctx).run_sync()
    [(message, kwargs)] = ctx.agent_holder[0].calls
    assert any(part.get('type') == 'image_url' for part in message)
    with SessionDB(db_path=tmp_path / 'state.db') as db:
        db.create_session('sid', source='local')
        row = _flush(db, message, kwargs['persist_user_message'])
        assert clean in row['content']
        assert 'Image attached at:' not in row['content']
        assert 'System note:' not in row['content']
        assert row['api_content'] == message


@pytest.mark.asyncio
async def test_native_image_without_caption_keeps_a_display_override(tmp_path):
    image = tmp_path / 'only.png'
    image.write_bytes(PNG)
    runner = object.__new__(GatewayRunner)
    runner.config, runner.adapters = GatewayConfig(), {}
    runner._decide_image_input_mode = lambda **_: 'native'
    event = MessageEvent(text='', source=SessionSource(platform=Platform.LOCAL, chat_id='local-chat'),
                         message_type=MessageType.PHOTO, media_urls=[str(image)], media_types=['image/png'])
    message = await runner._prepare_inbound_message_text(event=event, source=event.source, history=[], session_key='key')
    message, override, _ = runner._hmwa_apply_message_timestamp(event, message)
    assert message == ''  # native pixels are attached by the runner, independently of caption text
    assert override == f'@image:{image}'
