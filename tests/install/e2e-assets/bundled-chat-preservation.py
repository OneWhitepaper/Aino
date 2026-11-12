"""Verify OLD's real chat rows survive without adopting them into a NEW account."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3


def read_messages(home: Path, session_id: str | None = None):
    database = home / "state.db"
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        if session_id is None:
            rows = connection.execute("SELECT * FROM messages ORDER BY id")
        else:
            rows = connection.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY id", (session_id,))
        return [{key: {"sqliteBlobHex": value.hex()} if isinstance(value, bytes) else value
                 for key, value in dict(row).items()} for row in rows]


def snapshot_chat(receipt: dict) -> dict:
    assert receipt["status"] == "passed" and receipt["turnComplete"] is True
    home = Path(receipt["identity"]["hermesHome"]).resolve()
    messages = read_messages(home)
    user = next(row for row in messages if row["role"] == "user" and receipt["prompt"] in (row["content"] or ""))
    session = [row for row in messages if row["session_id"] == user["session_id"]]
    assert any(row["role"] == "assistant" and row["content"]
               and row["content"] in receipt["transcript"]["assistant"]["text"] for row in session)
    return {"home": str(home), "sessionId": user["session_id"], "messages": session}


def verify_chat(snapshot: dict) -> dict:
    current = {row["id"]: row for row in read_messages(Path(snapshot["home"]), snapshot["sessionId"])}
    for expected in snapshot["messages"]:
        actual = current.get(expected["id"])
        assert actual is not None, f"OLD chat message {expected['id']} was deleted"
        assert all(actual.get(key) == value for key, value in expected.items()), "OLD chat message changed"
    return {"status": "passed", "home": snapshot["home"], "sessionId": snapshot["sessionId"],
            "preservedMessages": len(snapshot["messages"]), "scope": "legacy-home-preserved-without-account-adoption"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["snapshot", "verify"])
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    data = json.loads(arguments.input.read_text())
    result = snapshot_chat(data) if arguments.operation == "snapshot" else verify_chat(data)
    arguments.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
