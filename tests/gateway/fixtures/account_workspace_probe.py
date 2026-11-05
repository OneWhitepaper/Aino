"""Real disk-backed runtime readers for the Desktop's independent account homes."""
import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace


def seed(marker):
    from cron.jobs import create_job
    from hermes_constants import get_hermes_home
    from hermes_state import SessionDB
    from tools.memory_tool import MemoryStore

    home = get_hermes_home()
    home.mkdir(parents=True, exist_ok=True)
    config = {"model": {"provider": "custom", "default": marker},
              "skills": {"external_dirs": []}, "auxiliary": {"title_generation": {"enabled": False}}}
    (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    profile = home / "profiles" / marker
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    skill = home / "skills" / marker
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        f"---\nname: {marker}\ndescription: Personal test workspace skill\n---\n{marker}\n",
        encoding="utf-8")
    memory = MemoryStore()
    memory.load_from_disk()
    assert memory.add("memory", f"Preferred notebook is {marker}.")["success"]
    create_job(prompt=f"Remember {marker}", schedule="0 0 1 1 *", name=marker, paused=True)
    db = SessionDB()
    try:
        db.create_session(marker, source="webui", model=marker)
        db.append_message(marker, role="user", content=f"Notebook {marker}")
        db.append_message(marker, role="assistant", content=f"Saved {marker}")
        db.set_session_title(marker, marker)
    finally:
        db.close()


def inspect(marker, foreign):
    from cron.jobs import list_jobs
    from hermes_cli.config import load_config
    from hermes_cli.profiles import list_profiles
    from hermes_constants import get_default_hermes_root, get_hermes_home
    from hermes_state import SessionDB
    from tools.memory_tool import load_on_disk_store
    from tools.skills_tool import find_all_skills

    db = SessionDB()
    try:
        return {"home": str(get_hermes_home()), "root": str(get_default_hermes_root()),
                "profiles": {p.name: str(p.path) for p in list_profiles(lazy_skill_count=True)},
                "model": load_config()["model"]["default"],
                "memory": load_on_disk_store().memory_entries,
                "skills": [s["name"] for s in find_all_skills()],
                "jobs": [j["name"] for j in list_jobs(include_disabled=True)],
                "sessions": [s["id"] for s in db.list_sessions_rich()],
                "own_search": [r["session_id"] for r in db.search_messages(marker)],
                "foreign_search": db.search_messages(foreign),
                "foreign_session": db.get_session(foreign),
                "foreign_messages": db.get_messages(foreign)}
    finally:
        db.close()


async def gateway_read(marker, foreign):
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import SessionRef
    from gateway.session_controls import AuthorityConnection
    from hermes_constants import get_hermes_home
    from hermes_state_runtime import RuntimeStoreError

    home = get_hermes_home()
    store = SessionStore(home / "sessions", GatewayConfig())
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _adapter_for_source=lambda source: None, _cached_agent_for=lambda route: None)
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id="account-test")
    identity = {"provider": "local", "user_id": "uid:same-os-user", "profile_id": str(home),
                "instance_id": authority.instance_id, "native_bootstrap": True}
    connection = AuthorityConnection(authority, object(), identity)
    try:
        refusals = {}
        for method in ("resume", "events_since", "info"):
            try:
                await getattr(connection, method)(SessionRef(str(home), foreign), {"session_id": foreign})
            except RuntimeStoreError as error:
                refusals[method] = error.reason
        opened = await connection.resume(SessionRef(str(home), marker), {"session_id": marker})
        return {"refusals": refusals, "messages": [m["content"] for m in opened["messages"]]}
    finally:
        await connection.close()
        store._db.close()


if __name__ == "__main__":
    action, marker, foreign = sys.argv[1:]
    if action == "seed":
        seed(marker)
        result = {"seeded": marker}
    elif action == "inspect":
        result = inspect(marker, foreign)
    else:
        result = asyncio.run(gateway_read(marker, foreign))
    print(json.dumps(result))
