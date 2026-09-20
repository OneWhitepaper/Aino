"""Selected expert discovery uses its real files through one default coordinator."""
from pathlib import Path

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


def test_catalog_and_completion_keep_selected_profile_skills_separate(runtime_env):
    server, _, _, home, _ = runtime_env
    from tui_gateway.conversation_commands import supported_read_commands
    from tui_gateway.hosted_room_service import HostedRoomService
    service = HostedRoomService(server, db_path=home / "shared-state.db").conversations
    for profile in ("default", "writer", "reviewer"):
        folder = (home if profile == "default" else home / "profiles" / profile) / "skills" / (profile + "-method")
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(f"---\nname: {profile}-method\ndescription: {profile} method\n---\nPrivate instruction {profile}")
    before = server._hermes_home
    for profile in ("writer", "default", "reviewer", "writer"):
        catalog = server._methods["commands.catalog"]("discovery", {"profile": profile})
        assert "error" not in catalog, catalog
        skills = catalog["result"]["skills"]
        assert "/" + profile + "-method" in skills
        assert all("/" + other + "-method" not in skills for other in {"default", "writer", "reviewer"} - {profile})
        completion = server._methods["complete.slash"]("discovery", {"profile": profile, "text": "/" + profile})
        assert "error" not in completion, completion
        assert any(item["text"].lstrip("/") == profile + "-method" for item in completion["result"]["items"])
        assert "Private instruction" not in str(completion) + str(catalog)
    assert server._hermes_home == before
    capabilities = service.capabilities()
    assert capabilities["scoped_commands"]
    assert capabilities["supported_read_commands"] == supported_read_commands()
