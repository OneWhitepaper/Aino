"""Dependency proofs read from immutable conversation recovery databases."""
from __future__ import annotations

import hashlib
import json
from contextlib import ExitStack, closing
from pathlib import Path

from hermes_cli.conversation_backup import (
    ConversationBackupError, profile_relative_home, read_db, rows, safe_member,
)


def _require(condition, message):
    if not condition:
        raise ConversationBackupError(message)


def _ancestors(conn, session_id):
    result, seen = [], set()
    while session_id:
        _require(session_id not in seen, "Cyclic session ancestry in snapshot")
        seen.add(session_id)
        row = conn.execute("SELECT id,parent_session_id FROM sessions WHERE id=?", (session_id,)).fetchone()
        _require(row is not None, "Snapshot is missing a required session lineage")
        result.append(row["id"])
        session_id = row["parent_session_id"]
    return result


def _receipt_proof(conn, prepared, receipt, profile):
    row = conn.execute("SELECT * FROM conversation_input_receipts WHERE input_id=?",
                       (prepared["input_id"],)).fetchone()
    _require(row is not None, "Shared ACK has no durable Profile receipt")
    envelope = json.loads(prepared["envelope_json"])
    _require(tuple(row[key] for key in ("conversation_id", "participant_id", "session_generation", "input_digest")) == (
        prepared["conversation_id"], prepared["participant_id"], prepared["session_generation"], envelope["input_digest"]),
        "Profile receipt identity or envelope digest differs from shared input")
    if receipt is not None:
        _require(all(row[key] == receipt[key] for key in (
            "input_id", "input_digest", "session_id", "message_row_id")), "Shared ACK differs from Profile receipt")
    message = conn.execute("SELECT session_id,role FROM messages WHERE id=?", (row["message_row_id"],)).fetchone()
    _require(message is not None and tuple(message) == (row["session_id"], "user"),
             "Profile receipt has no matching user message")
    ancestry = _ancestors(conn, row["session_id"])
    if prepared["lineage_id"]:
        other = _ancestors(conn, prepared["lineage_id"])
        _require(ancestry[-1] == other[-1], "Profile receipt belongs to a different lineage")
    return {"profile": profile, "input_id": row["input_id"], "session_id": row["session_id"],
            "message_row_id": row["message_row_id"], "input_digest": row["input_digest"]}


def validate_projection(root: Path) -> dict:
    with ExitStack() as stack:
        shared = stack.enter_context(closing(read_db(root / "shared-state.db")))
        profiles = {}

        def profile_db(profile):
            if profile not in profiles:
                path = safe_member(root, (profile_relative_home(profile) / "state.db").as_posix())
                profiles[profile] = stack.enter_context(closing(read_db(path)))
            return profiles[profile]

        install_id = (root / "install_id").read_text(encoding="utf-8").strip()
        _require(len(install_id) == 32 and all(c in "0123456789abcdef" for c in install_id),
                 "Snapshot is missing its stable installation identity")
        conversations = rows(shared, "hosted_room_conversations")
        _require(bool(conversations), "Snapshot contains no ordinary conversations")
        ids = {row["conversation_id"] for row in conversations}
        rooms = {row["room_id"]: row for row in rows(shared, "hosted_rooms") if row["room_id"] in ids}
        _require(len(rooms) == len(ids) and all(r["purpose"] == "conversation" for r in rooms.values()),
                 "Conversation metadata has no matching ordinary room")
        events = {(r["room_id"], r["event_id"]): r for r in rows(shared, "hosted_room_events") if r["room_id"] in ids}
        cutoffs = {cid: room["next_seq"] - 1 for cid, room in rooms.items()}
        for cid, cutoff in cutoffs.items():
            seqs = sorted(r["seq"] for r in events.values() if r["room_id"] == cid)
            _require(seqs == list(range(1, cutoff + 1)), "Conversation event history has a gap")
        participants = rows(shared, "hosted_room_conversation_participants")
        by_participant = {(p["conversation_id"], p["participant_id"]): p for p in participants}
        _require(all(p["install_id"] == f"install:{install_id}" for p in participants),
                 "Snapshot contains an unsupported remote participant")
        runtimes = rows(shared, "hosted_room_conversation_runtimes")
        lineages = []
        for runtime in runtimes:
            db = profile_db(runtime["profile"])
            ancestry = _ancestors(db, runtime["lineage_id"])
            if runtime["system_prompt_digest"]:
                prompt = db.execute("""SELECT COALESCE(s.system_prompt,p.prompt) FROM sessions s
                    LEFT JOIN system_prompts p ON p.hash=s.system_prompt_hash WHERE s.id=?""",
                    (runtime["lineage_id"],)).fetchone()[0]
                _require(isinstance(prompt, str) and hashlib.sha256(prompt.encode()).hexdigest() == runtime["system_prompt_digest"],
                         "Runtime prompt proof has no matching durable Profile prompt")
            lineages.append({key: runtime[key] for key in (
                "conversation_id", "participant_id", "session_generation", "profile", "lineage_id",
                "capability_digest", "system_prompt_digest") } | {"ancestors": ancestry})
        for participant in participants:
            if participant["lineage_id"]:
                _ancestors(profile_db(participant["profile"]), participant["lineage_id"])
                _require(any(all(runtime[key] == participant[key] for key in (
                    "conversation_id", "participant_id", "session_generation", "profile", "lineage_id"))
                    for runtime in runtimes), "Participant has no matching runtime generation")

        prepared = {(row["conversation_id"], row["input_id"]): row
                    for row in rows(shared, "hosted_conversation_prepared_inputs")}
        acks = {(row["conversation_id"], row["input_id"]): row
                for row in rows(shared, "hosted_conversation_input_acks")}
        receipt_proofs, unaccepted = [], []
        for key, item in prepared.items():
            profile = by_participant[(item["conversation_id"], item["participant_id"])]["profile"]
            db = profile_db(profile)
            receipt = db.execute("SELECT 1 FROM conversation_input_receipts WHERE input_id=?", (item["input_id"],)).fetchone()
            ack = acks.get(key)
            if receipt or ack:
                receipt_proofs.append(_receipt_proof(db, item, json.loads(ack["receipt_json"]) if ack else None, profile))
            else:
                unaccepted.append({"conversation_id": key[0], "input_id": key[1]})
            envelope = json.loads(item["envelope_json"])
            _validate_coverage(events, key[0], envelope["source_event_ids"], envelope["through_seq"])
        _require(set(acks).issubset(prepared), "Shared ACK has no frozen envelope")
        for row in (*acks.values(), *rows(shared, "hosted_conversation_summaries")):
            _validate_coverage(events, row["conversation_id"], json.loads(row["source_ids_json"]), row["through_seq"])

        content = rows(shared, "hosted_conversation_content")
        owners = {(row["conversation_id"], row["content_id"]) for row in rows(shared, "hosted_conversation_content_owners")}
        blobs = {}
        for row in content:
            data = bytes(row["data"])
            _require(len(data) == row["size_bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"],
                     "Durable conversation content checksum mismatch")
            blobs[row["id"]] = {key: row[key] for key in ("id", "sha256", "size_bytes", "mime_type")}
        for cid, content_id in owners:
            _require(cid in ids and content_id in blobs, "Content ownership references a missing dependency")
        for event in events.values():
            payload = json.loads(event["payload_json"])
            if ref := payload.get("content_ref"):
                _require((event["room_id"], ref["id"]) in owners and blobs[ref["id"]] == ref,
                         "Public event references missing or different content")
        attachments = rows(shared, "hosted_conversation_attachments")
        for attachment in attachments:
            _require((attachment["conversation_id"], attachment["content_id"]) in owners,
                     "Attachment has no owned durable content")
        inputs = {(row["conversation_id"], row["input_id"]): row
                  for row in rows(shared, "hosted_room_conversation_inputs")}
        tokens = rows(shared, "hosted_conversation_command_tokens")
        for token in tokens:
            if token["consumed_input_id"]:
                key = (token["conversation_id"], token["consumed_input_id"])
                _require(key in inputs and key in prepared, "Consumed command has no frozen input")
            elif token["body"] is not None:
                _require(hashlib.sha256(token["body"].encode()).hexdigest() == token["body_sha256"],
                         "Private command body differs from its proof")
        projects = []
        for conversation in conversations:
            if conversation["project_json"]:
                project = json.loads(conversation["project_json"])
                path = profile_relative_home(project["registration_profile"]) / "projects.db"
                db = stack.enter_context(closing(read_db(safe_member(root, path.as_posix()))))
                _require(db.execute("SELECT 1 FROM projects WHERE id=?", (project["project_id"],)).fetchone(),
                         "Conversation project registration is missing")
                projects.append(project)
        migrations = []
        mapped_rows = rows(shared, "hosted_conversation_migration_rows")
        for migration in rows(shared, "hosted_conversation_migrations"):
            receipt = json.loads(migration["receipt_json"])
            profile = receipt["source_profile"]
            db = profile_db(profile)
            source = db.execute("SELECT * FROM session_conversation_migrations WHERE migration_id=?",
                                (receipt["migration_id"],)).fetchone()
            _require(source is not None and all(source[key] == receipt[key] for key in (
                "conversation_id", "source_profile", "source_lineage_id", "source_cutoff_row_id")),
                "Migration has no matching durable source fence")
            manifest = json.loads(migration["manifest_json"])
            _require(manifest == json.loads(source["manifest_json"]), "Migration public projection differs from frozen source")
            imported = [row for row in mapped_rows if row["migration_id"] == receipt["migration_id"]]
            allowed = {row["source_row_id"]: row for row in manifest}
            for row in imported:
                _require(row["source_row_id"] in allowed and row["source_row_id"] <= receipt["source_cutoff_row_id"],
                         "Migration references a row outside its frozen source")
                _require(db.execute("SELECT 1 FROM messages WHERE id=?", (row["source_row_id"],)).fetchone(),
                         "Migration original message is missing")
                event = events.get((receipt["conversation_id"], row["event_id"]))
                _require(event is not None and event["seq"] == row["seq"], "Migration public mapping is missing")
            if receipt["status"] == "complete":
                _require({row["source_row_id"] for row in imported} == set(allowed), "Complete migration has missing public rows")
            migrations.append(receipt)
        return {
            "install_id": install_id, "event_cutoffs": cutoffs,
            "lineages": sorted(lineages, key=lambda r: (r["conversation_id"], r["participant_id"], r["session_generation"])),
            "receipts": sorted(receipt_proofs, key=lambda r: (r["profile"], r["input_id"])),
            "unaccepted_inputs": sorted(unaccepted, key=lambda r: (r["conversation_id"], r["input_id"])),
            "content": sorted(blobs.values(), key=lambda r: r["id"]),
            "projects": sorted(projects, key=lambda r: (r["registration_profile"], r["project_id"])),
            "background_origins": rows(shared, "hosted_conversation_background_origins"),
            "migrations": sorted(migrations, key=lambda r: r["migration_id"]),
        }


def _validate_coverage(events, cid, source_ids, cutoff):
    _require(len(source_ids) == len(set(source_ids)) and all(
        (cid, event_id) in events and events[(cid, event_id)]["seq"] <= cutoff for event_id in source_ids),
        "Context coverage references missing public events")
