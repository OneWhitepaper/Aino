"""A fresh HOME restores real G/A/B turns and executes the next Profile turn."""
import io
import json
from pathlib import Path
import threading
from http.server import HTTPServer

import yaml

from tests.agent.test_api_content_sidecar import _MockHandler, _text_resp
from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


def test_restore_three_real_agents_and_continue_in_fresh_home(runtime_env, monkeypatch):
    from gateway import hosted_room_driver as driver
    from hermes_cli.conversation_backup import create_conversation_snapshot
    from hermes_cli.conversation_restore import restore_conversation_snapshot
    from hermes_state import SessionDB
    from tui_gateway.hosted_room_service import HostedRoomService

    server, _, _, home, tmp = runtime_env
    class Provider(_MockHandler):
        captured_requests = []
        response_queue = []
        def do_POST(self):  # noqa: N802
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            type(self).response_queue = [_text_resp("Verified reply from restored-capable agent")]
            self.rfile = io.BytesIO(data)
            super().do_POST()

    http = HTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    for profile in ("default", "writer", "reviewer"):
        profile_home = home if profile == "default" else home / "profiles" / profile
        path = profile_home / "config.yaml"
        config = yaml.safe_load(path.read_text())
        config["providers"]["test"]["api"] = f"http://127.0.0.1:{http.server_port}/v1"
        config["compression"] = {"enabled": False}
        path.write_text(yaml.safe_dump(config))
        (profile_home / "SOUL.md").write_text("Private persona for " + profile)
    hosted = HostedRoomService(server, db_path=home / "shared-state.db")
    monkeypatch.setattr(server, "get_conversation_service", lambda: hosted.conversations)

    def call(method, **params):
        response = server._methods["conversations." + method]("restore-test", params)
        assert "error" not in response, response
        return response["result"]

    def send(profile, index):
        current = call("get", conversation_id="recoverable")["conversation"]
        call("send", conversation_id="recoverable", turn_id=f"t{index}", input_id=f"i{index}",
             participant_id=participants[profile], text=f"Public request {index}", expected_revision=current["revision"])
        room = hosted.conversations.bindings()[0]
        hosted.runtime.turn_timeout_seconds = 15
        hosted.runtime._process_room(room)
        hosted.conversations.prepare_room(room)
        task = next(t for t in driver.list_tasks(hosted.db_path, room_id="recoverable") if t["identity"].turn_id == f"t{index}")
        assert task["status"] == "settled", task

    def close_agents():
        for session in list(server._sessions.values()):
            if session.get("agent"):
                session["agent"].close()
        server._sessions.clear()
        server._db.close()

    try:
        participants = {row["participant"]["profile"]: row["participant"]["participant_id"]
                        for row in call("participants")["participants"]}
        call("create", conversation_id="recoverable", title="Recovery", general_participant_id=participants["default"])
        for index, profile in enumerate(("default", "writer", "reviewer")):
            send(profile, index)
        history = call("events", conversation_id="recoverable")["events"]
        snapshot = tmp / "recovery-set"
        create_conversation_snapshot(home, snapshot)
        close_agents()
        fresh_user = tmp / "fresh-user"
        fresh_home = fresh_user / ".hermes"
        restore_conversation_snapshot(snapshot, fresh_home)
        monkeypatch.setattr(Path, "home", lambda: fresh_user)
        monkeypatch.setenv("HOME", str(fresh_user))
        monkeypatch.setenv("HERMES_HOME", str(fresh_home))
        monkeypatch.setattr(server, "_hermes_home", fresh_home)
        monkeypatch.setattr(server, "_conversation_db_path", fresh_home / "shared-state.db")
        monkeypatch.setattr(server, "_db", SessionDB(fresh_home / "state.db"))
        hosted = HostedRoomService(server, db_path=fresh_home / "shared-state.db")
        assert call("events", conversation_id="recoverable")["events"] == history
        send("writer", 3)
        restored = call("events", conversation_id="recoverable")["events"]
        assert restored[:len(history)] == history
        assert restored[-1]["actor"]["id"] == participants["writer"]
        assert any("Public request 2" in json.dumps(request.get("messages")) and "Public request 3" in json.dumps(request.get("messages"))
                   for request in Provider.captured_requests)
    finally:
        close_agents()
        http.shutdown()
        http.server_close()
        thread.join(5)
