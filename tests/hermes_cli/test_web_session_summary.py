"""Independent summaries preserve transcripts and only cite the owning display history."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from hermes_state import SessionDB
from hermes_cli import web_session_summary as summaries


def _conversation(home, sid="task"):
    home.mkdir(parents=True, exist_ok=True)
    db = SessionDB(db_path=home / "state.db")
    db.create_session(sid, "gui")
    first = db.append_message(sid, "user", "Please implement an independent session summary with references. " * 12)
    reply = db.append_message(sid, "assistant", "Implemented the display history reader and validated its isolation. " * 12)
    return db, first, reply


def _point(mid):
    return {"objective": {"text": "Implement a cited summary.", "message_ids": [mid]},
            "completed": [], "conclusions": [], "open_questions": []}


def test_real_aux_route_caches_accounts_and_isolates_language_and_profile(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr("hermes_state.DEFAULT_DB_PATH", home / "state.db")
    db, first, reply = _conversation(home)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(request)
            rows = json.loads(request["messages"][-1]["content"])
            response = {"id": "summary", "object": "chat.completion", "created": 1,
                        "model": request["model"], "choices": [{"index": 0, "finish_reason": "stop",
                        "message": {"role": "assistant", "content": json.dumps(_point(rows[0]["id"]))}}],
                        "usage": {"prompt_tokens": 20, "completion_tokens": 15, "total_tokens": 35}}
            body = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    config = {"model": {"default": "local-model", "provider": "fixture"},
              "custom_providers": [{"name": "fixture", "base_url": f"http://127.0.0.1:{server.server_port}/v1",
                                    "api_key": "fixture-key"}],
              "auxiliary": {"session_summary": {"provider": "fixture", "model": "summary-model", "timeout": 5}}}
    (home / "config.yaml").write_text(json.dumps(config))
    before = db.get_messages("task", include_inactive=True)
    try:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from hermes_cli.web_routers.session_summary import router
        app = FastAPI()
        app.include_router(router)
        with TestClient(app) as client:
            initial = client.get("/api/sessions/task/summary").json()
            assert initial["eligible"] and initial["summary"] is None and not requests
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(client.post, "/api/sessions/task/summary", json={"language": "en"}) for _ in range(2)]
                results = [f.result().json() for f in futures]
            assert len(requests) == 1
            assert results[0] == results[1]
            assert results[0]["summary"]["objective"]["message_ids"] == [first]
            assert not results[0]["stale"]
            other_language = client.post("/api/sessions/task/summary", json={"language": "ja"}).json()
            assert other_language["summary"] and len(requests) == 2
            assert db.get_messages("task", include_inactive=True) == before
            usage = db._read_one("SELECT SUM(input_tokens), SUM(output_tokens), SUM(api_call_count) FROM session_model_usage WHERE session_id = ? AND task = ?", ("task", "session_summary"))
            assert tuple(usage) == (40, 30, 2)
            alternate = home / "profiles" / "work"
            other_db, other_first, _ = _conversation(alternate)
            (alternate / "config.yaml").write_text(json.dumps(config))
            try:
                assert client.get("/api/sessions/task/summary?profile=work&language=en").json()["summary"] is None
                scoped = client.post("/api/sessions/task/summary", json={"profile": "work", "language": "en"}).json()
                assert scoped["summary"]["objective"]["message_ids"] == [other_first]
                assert len(requests) == 3
                assert other_db.get_messages("task")[0]["content"] == before[0]["content"]
            finally:
                other_db.close()
    finally:
        server.shutdown()
        server.server_close()
        worker.join(5)
        db.close()


def test_visibility_revision_failure_and_busy_guards_keep_history_intact(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr("hermes_state.DEFAULT_DB_PATH", home / "state.db")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    db, first, reply = _conversation(home)
    (home / "config.yaml").write_text(json.dumps({"auxiliary": {"session_summary": {"provider": "fixture"}}}))
    hidden = db.append_message("task", "user", "internal scaffolding", display_kind="hidden")
    db._execute_write(lambda conn: conn.execute("UPDATE messages SET active=0, compacted=1 WHERE id=?", (first,)))
    calls = []

    def model(rows, language, allowed, **kwargs):
        calls.append(rows)
        return _point(rows[0]["id"])

    monkeypatch.setattr(summaries, "_call", model)
    try:
        original = db.get_messages("task", include_inactive=True)
        result = summaries.session_summary("task", language="en", generate=True)
        assert result["summary"]["objective"]["message_ids"] == [first]
        assert first in {r["id"] for r in calls[0]} and hidden not in {r["id"] for r in calls[0]}
        assert db.get_messages("task", include_inactive=True) == original
        db.create_session("greeting", "gui")
        db.append_message("greeting", "user", "hi")
        db.append_message("greeting", "assistant", "Hello!")
        assert not summaries.session_summary("greeting", generate=True)["eligible"] and len(calls) == 1
        assert db.try_acquire_session_turn_lease("task", "test-summary")
        db.append_message("task", "user", "Please check the next stage.")
        busy = summaries.session_summary("task", language="en", generate=True)
        assert busy["busy"] and busy["stale"] and len(calls) == 1
        db.release_session_turn_lease("task", "test-summary")

        failures = []
        def fail(*args, **kwargs):
            failures.append(True)
            raise ValueError("invalid citation")

        monkeypatch.setattr(summaries, "_call", fail)
        failed = summaries.session_summary("task", language="en", generate=True)
        assert failed["summary"] == result["summary"] and failed["stale"] and failed["error"]
        # A result generated from an old revision cannot overwrite the snapshot.
        def race(rows, *args, **kwargs):
            db.append_message("task", "assistant", "New evidence arrived during summary generation.")
            return _point(first)

        monkeypatch.setattr(summaries, "_call", race)
        assert summaries.session_summary("task", language="en", generate=True) == failed
        assert summaries.session_summary("task", language="en")["error_code"] == "generation_failed"
        assert len(failures) == 1
        raced = summaries.session_summary("task", language="en", generate=True, retry=True)
        assert raced["summary"] == result["summary"] and raced["stale"]
        # All portions, including the middle of a large row, enter a chunk before synthesis.
        chunk_calls = []
        def chunk_model(rows, language, allowed, **kwargs):
            chunk_calls.append((rows, kwargs.get("merging", False)))
            return _point(min(allowed))

        monkeypatch.setattr(summaries, "_call", chunk_model)
        monkeypatch.setattr(summaries, "_CHUNK_CHARS", 128)
        source = summaries._source(db, "task")
        summaries._generate(source, "en")
        assert chunk_calls[-1][1]
        reconstructed = {}
        for rows, merging in chunk_calls:
            if not merging:
                for row in rows:
                    reconstructed[row["id"]] = reconstructed.get(row["id"], "") + row["content"]
        assert reconstructed == {row["id"]: row["content"] for row in source["rows"]}
        monkeypatch.setattr(summaries, "_MAX_SOURCE_CHARS", 1)
        limited = summaries.session_summary("task", language="en", generate=True)
        assert limited["error_code"] == "input_limit" and limited["summary"] == result["summary"]
        db._execute_write(lambda conn: conn.execute("UPDATE messages SET active=0, compacted=0 WHERE id=?", (first,)))
        assert summaries.session_summary("task", language="en")["summary"] is None
        try:
            summaries._validate(_point(hidden), {reply})
        except ValueError:
            pass
        else:
            raise AssertionError("Hidden citation accepted")
    finally:
        db.close()
