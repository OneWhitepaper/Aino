"""The upgrade must preserve OLD chats even when NEW intentionally isolates accounts."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sqlite3

import pytest


@pytest.fixture
def fixture(tmp_path):
    path = Path(__file__).resolve().parents[2] / "install/e2e-assets/bundled-chat-preservation.py"
    spec = spec_from_file_location("bundled_chat_preservation", path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    database = tmp_path / "state.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT)")
        connection.executemany("INSERT INTO messages VALUES (?, ?, ?, ?)", [
            (1, "old-session", "user", "unique-old-chat-prompt"),
            (2, "old-session", "assistant", "Hello from the mock inference server!"),
            (3, "unrelated", "user", "unrelated chat"),
        ])
        connection.execute("ALTER TABLE messages ADD COLUMN display_identity BLOB")
        connection.execute("UPDATE messages SET display_identity = ? WHERE id = 2", (b"\x00\xff",))
    receipt = {"status": "passed", "turnComplete": True, "identity": {"hermesHome": str(tmp_path)},
               "prompt": "unique-old-chat-prompt", "transcript": {"assistant": {"text": "Hello from the mock inference server!"}}}
    return module, database, receipt


def test_real_old_chat_rows_survive_without_being_adopted_by_another_account(fixture):
    module, database, receipt = fixture
    snapshot = module.snapshot_chat(receipt)
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO messages (id, session_id, role, content) VALUES (4, 'new-session', 'user', 'new account message')")
    result = module.verify_chat(snapshot)
    assert result["preservedMessages"] == 2
    assert result["home"] == receipt["identity"]["hermesHome"]
    assert result["sessionId"] == "old-session"


@pytest.mark.parametrize("mutation", ["DELETE FROM messages WHERE id = 2", "UPDATE messages SET content = 'changed' WHERE id = 2"])
def test_a_fresh_new_chat_does_not_hide_lost_or_modified_old_chat(fixture, mutation):
    module, database, receipt = fixture
    snapshot = module.snapshot_chat(receipt)
    with sqlite3.connect(database) as connection:
        connection.execute(mutation)
    with pytest.raises(AssertionError):
        module.verify_chat(snapshot)
