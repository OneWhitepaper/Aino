"""Retired setup handoffs keep their model-only skill tail out of saved chat display."""

from hermes_state import SessionDB
from tui_gateway import server


def test_saved_first_task_handoff_displays_only_the_authored_ask(tmp_path):
    db = SessionDB(tmp_path / "state.db")
    db.create_session("legacy-first-task", "desktop")
    visible = "Build my weekly report.\n\nWhat setup learned: I prefer concise summaries."
    saved = visible + "\n\n[/first-task]\n\n# Internal first-task skill\nFollow the setup instructions."
    db.append_message("legacy-first-task", "user", saved)
    db.append_message("legacy-first-task", "assistant", "I will prepare it.")
    db.append_message("legacy-first-task", "user", "Include next week too.")
    try:
        history = db.get_messages_as_conversation("legacy-first-task")
        displayed = server._history_to_messages(history)
        assert [row["text"] for row in displayed] == [visible, "I will prepare it.", "Include next week too."]
        assert db.get_messages_as_conversation("legacy-first-task")[0]["content"] == saved
    finally:
        db.close()


def test_normal_content_and_assistant_markers_are_preserved():
    ordinary = "Explain the [/first-task] marker in this sentence."
    assistant = "Example\n\n[/first-task]\n\nQuoted legacy format."
    displayed = server._history_to_messages([
        {"role": "user", "content": ordinary}, {"role": "assistant", "content": assistant},
    ])
    assert [row["text"] for row in displayed] == [ordinary, assistant]
