"""Removing model-only image descriptions must retain the rest of a mixed media turn."""
from unittest.mock import AsyncMock, Mock

import pytest

from gateway.config import GatewayConfig, Platform
from gateway.platforms.event import MessageEvent, MessageType
from gateway.run import GatewayRunner
from gateway.run_inbound import persist_inbound_user_message
from gateway.session import SessionSource
from tests.gateway.test_prompt_attachments import _ONE_PX_PNG


def _runner(monkeypatch):
    runner = object.__new__(GatewayRunner)
    runner.config, runner.adapters = GatewayConfig(), {}
    runner._decide_image_input_mode = lambda **kwargs: 'text'
    runner._resolve_session_agent_runtime = lambda **kwargs: ('fixture', {'provider': 'custom'})
    runner._enrich_message_with_vision = AsyncMock(side_effect=lambda text, paths: f'VISION-CONTEXT\n\n{text}')
    runner._should_echo_stt_transcripts = lambda: True
    adapter = Mock(send=AsyncMock())
    runner._delivery_adapter_for = lambda source: adapter
    runner._reply_anchor_for_event = lambda event: None
    runner._thread_metadata_for_source = lambda *args: None
    transcribe = Mock(return_value={'success': True, 'transcript': 'voice words'})
    monkeypatch.setattr('tools.transcription_tools.transcribe_audio', transcribe)
    return runner, adapter, transcribe


@pytest.mark.asyncio
@pytest.mark.parametrize('queued', [False, True])
async def test_image_and_voice_display_keep_stt_once_including_pretranscribed_queue(tmp_path, monkeypatch, queued):
    runner, adapter, transcribe = _runner(monkeypatch)
    image, voice = tmp_path / 'image.png', tmp_path / 'voice.ogg'
    image.write_bytes(_ONE_PX_PNG)
    voice.write_bytes(b'voice')
    source = SessionSource(platform=Platform.LOCAL, chat_id='mixed')
    event = MessageEvent(text='caption', source=source, message_type=MessageType.VOICE,
                         media_urls=[str(image), str(voice)], media_types=['image/png', 'audio/ogg'])
    if queued:
        await runner._transcribe_and_echo_pending_voice(event, adapter, source, event.text, log_context='queued')
    message = await runner._prepare_inbound_message_text(event=event, source=source, history=[], session_key='key')
    display = persist_inbound_user_message(event, message)

    assert display == f'"voice words"\n\ncaption\n@image:{image}'
    assert message == ('VISION-CONTEXT\n\n"voice words"\n\ncaption' if queued
                       else '"voice words"\n\nVISION-CONTEXT\n\ncaption')
    transcribe.assert_called_once_with(str(voice), None, 'gateway')
    assert adapter.send.await_count == 1


@pytest.mark.asyncio
async def test_image_display_keeps_pdf_audio_file_and_video_attachment_notes(tmp_path, monkeypatch):
    runner, adapter, transcribe = _runner(monkeypatch)
    paths = [tmp_path / name for name in ('image.png', 'report.pdf', 'song.mp3', 'clip.mp4')]
    paths[0].write_bytes(_ONE_PX_PNG)
    for path in paths[1:]:
        path.write_bytes(b'attachment')
    source = SessionSource(platform=Platform.LOCAL, chat_id='mixed')
    event = MessageEvent(text='inspect all', source=source, message_type=MessageType.DOCUMENT,
        media_urls=list(map(str, paths)), media_types=['image/png', 'application/pdf', 'audio/mpeg', 'video/mp4'],
        media_filenames=['photo.png', 'annual report.pdf', 'my song.mp3', 'my clip.mp4'],
        media_text_inlined=[False] * 4)
    message = await runner._prepare_inbound_message_text(event=event, source=source, history=[], session_key='key')
    display = persist_inbound_user_message(event, message)

    # Every non-vision prefix reaches display in the same order as the model's existing payload.
    expected_tail = f'inspect all\n@image:{paths[0]}'
    assert display == message.replace('VISION-CONTEXT\n\ninspect all', expected_tail)
    for name, path in zip(('annual report.pdf', 'my song.mp3', 'my clip.mp4'), paths[1:]):
        assert name in display and str(path) in display
    transcribe.assert_not_called()
    adapter.send.assert_not_awaited()
