"""Image persistence content shared by the canonical gateway and legacy TUI."""
from agent.image_routing import build_persist_message_with_image_refs, build_persist_user_message


def test_build_persist_message_with_image_refs_without_images_returns_text(monkeypatch):
    """#70720: when no images are attached the persisted message is the raw
    prompt — no @image directive prefix is introduced."""
    assert build_persist_message_with_image_refs("what is this?", []) == "what is this?"
    assert build_persist_message_with_image_refs("", []) == ""


def test_build_persist_message_with_image_refs_appends_existing_paths(monkeypatch, tmp_path):
    """Attached images that still exist on disk are persisted as trailing
    ``@image:<path>`` directive lines so the desktop renders them after a
    restart (instead of the vision-only enrichment that silently breaks)."""
    img = tmp_path / "cat.png"
    img.write_bytes(b"\x89PNG")

    result = build_persist_message_with_image_refs("what is in this photo?", [str(img)])

    assert result == f"what is in this photo?\n@image:{img}"


def test_build_persist_message_with_image_refs_skips_missing_paths(monkeypatch, tmp_path):
    """Only paths that still exist are persisted; a missing file must not
    inject a dangling @image ref into the transcript."""
    existing = tmp_path / "a.png"
    existing.write_bytes(b"png")
    missing = str(tmp_path / "gone.png")

    result = build_persist_message_with_image_refs("compare them", [str(existing), missing])

    assert result == f"compare them\n@image:{existing}"


def test_build_persist_message_with_image_refs_without_text_is_refs_only(monkeypatch, tmp_path):
    """A stand-alone attachment (no caption) persists as just the directive
    line, so a bare image survives in history and is not dropped as empty."""
    img = tmp_path / "only.png"
    img.write_bytes(b"png")

    assert build_persist_message_with_image_refs("", [str(img)]) == f"@image:{img}"


def test_build_persist_message_quotes_paths_containing_spaces(tmp_path):
    """The unquoted alternative in the directive pattern is ``\\S+``, so a path
    with a space parses as a truncated ref with the tail left as loose text.
    Desktop composer images live in the app's userData dir, which on macOS is
    ``~/Library/Application Support/...`` — a space every time."""
    img_dir = tmp_path / "Application Support" / "Hermes" / "composer-images"
    img_dir.mkdir(parents=True)
    img = img_dir / "cat.png"
    img.write_bytes(b"png")

    result = build_persist_message_with_image_refs("what is this?", [str(img)])

    assert result == f"what is this?\n@image:`{img}`"


def test_persist_user_message_mirrors_the_shape_sent_to_the_model(tmp_path):
    """A native-vision turn sends ``content`` as a parts list, and the session
    store ignores a plain-string override for a list payload. The override must
    mirror the list shape (ref text + the original image parts) or it is
    silently dropped and the attachment never reaches history."""
    img = tmp_path / "cat.png"
    img.write_bytes(b"png")
    image_part = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    native_parts = [{"type": "text", "text": "api-only text"}, image_part]

    override = build_persist_user_message("what is this?", [str(img)], native_parts)

    assert override == [{"type": "text", "text": f"what is this?\n@image:{img}"}, image_part]


def test_persist_user_message_stays_a_string_for_text_mode(tmp_path):
    """Text-mode (vision-preprocessed) turns send a string, so the override
    stays a string — the shape the session store rewrites directly."""
    img = tmp_path / "cat.png"
    img.write_bytes(b"png")

    override = build_persist_user_message("what is this?", [str(img)], "enriched api-only text")

    assert override == f"what is this?\n@image:{img}"


def test_native_vision_turn_persists_a_renderable_image_ref(tmp_path):
    """End to end through the real session-store flush: whichever image input
    mode the turn used, the durable row carries an ``@image:`` ref the desktop
    can render after a restart."""
    from unittest.mock import MagicMock

    from agent.image_routing import build_native_content_parts
    from run_agent import AIAgent

    img_dir = tmp_path / "Application Support" / "composer-images"
    img_dir.mkdir(parents=True)
    img = img_dir / "cat.png"
    img.write_bytes(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d494844520000000100000001080600000"
            "01f15c4890000000a49444154789c6360000002000100ffff0300000600"
            "0557bfabd40000000049454e44ae426082"
        )
    )
    native_parts, skipped = build_native_content_parts("what is in this photo?", [str(img)])
    assert not skipped

    agent = AIAgent.__new__(AIAgent)
    agent._session_db = MagicMock()
    agent._session_db_created = True
    agent.session_id = "s-1"
    agent._last_flushed_db_idx = 0
    agent._persist_disabled = False
    agent._flushed_db_message_ids = set()
    agent._flushed_db_message_session_id = None
    agent._pending_cli_user_message = None
    agent._persist_user_message_timestamp = None
    agent._persist_user_message_idx = 0
    agent._persist_user_message_override = build_persist_user_message(
        "what is in this photo?", [str(img)], native_parts
    )

    agent._flush_messages_to_session_db([{"role": "user", "content": native_parts}], [])

    written = agent._session_db.append_messages_batch.call_args.kwargs["messages"][0]["content"]
    assert f"@image:`{img}`" in written
    assert "what is in this photo?" in written
    # The model keeps the pixels for the rest of the session.
    assert any(part.get("type") == "image_url" for part in agent._persist_user_message_override)
