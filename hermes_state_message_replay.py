"""Stored-row decoding for conversation replay, preserving durable API payloads."""

from agent.api_content import decode_api_content
from agent.context_compressor import _DB_PERSISTED_MARKER as _DB_PERSISTED_MARKER_KEY
from agent.message_metadata import DB_ROW_SNAPSHOT
from hermes_state_common import _json_or
from hermes_state_identity import _restore_identity_columns


def decode_replay_row(db, row, *, stamp_snapshot, include_row_ids, include_summary_markers):
    # Late import: transcript repair uses the state message mixin.
    from agent.transcript_repair import transcript_row_snapshot

    content = db._loaded_view_content(row["role"], db._decode_content(row["content"]))
    # Underscore-prefixed like ``_row_id``: transports strip it before the wire; compression's
    # assembly copies strip it so rotated child handoffs still flush (_fresh_compaction_message_copy).
    msg = {"role": row["role"], "content": content, _DB_PERSISTED_MARKER_KEY: True}
    if stamp_snapshot:
        msg[DB_ROW_SNAPSHOT] = transcript_row_snapshot(row)
    # Born durable (#92231): this dict is materialized FROM a durable row, so stamp the persistence
    # marker at the source instead of relying on every restore caller to thread the loaded list back
    # through a flush as ``conversation_history=`` — any identity-losing handoff (compression's
    # durable-snapshot adoption, incremental persists with no history arg) would otherwise re-append
    # the ENTIRE transcript on flush.
    if include_row_ids and row["id"] is not None:
        msg["_row_id"] = row["id"]
    _restore_identity_columns(row, msg)
    if row["api_content"]:
        msg["api_content"] = decode_api_content(row["api_content"])
    if row["display_kind"]:
        msg["display_kind"] = row["display_kind"]
    if row["display_metadata"] and (decoded := db._decode_display_metadata(row["display_metadata"])) is not None:
        msg["display_metadata"] = decoded
    if include_summary_markers and row["_compressed_summary"]:
        msg["_compressed_summary"] = True
    msg.update(
        (col, row[col]) for col in ("timestamp", "tool_call_id", "tool_name", "effect_disposition") if row[col])
    if row["tool_calls"]:
        msg["tool_calls"] = _json_or(
            row["tool_calls"], [], "Failed to deserialize tool_calls in conversation replay, falling back to []")
    if row["platform_message_id"]:  # platform-side id exposed as ``message_id`` (JSONL transcript compat)
        msg["message_id"] = row["platform_message_id"]
    if row["observed"]:
        msg["observed"] = True
    return msg
