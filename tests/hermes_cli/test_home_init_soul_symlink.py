"""Home initialization must survive a SOUL.md symlink the seed cannot write through.

A cyclic ``SOUL.md -> SOUL.md`` link (ELOOP) or a link dangling into a missing directory
(ENOENT) made the first-run seed raise OSError, which ``initialize_home`` turned into
``HomeInitializationError`` on every gateway spawn (launchd exit-75 relaunch storm). The seed
now replaces such a link with the default identity file; a link that resolves is operator
wiring and stays a link.
"""

import os
from unittest.mock import patch

import pytest

from hermes_cli.config import DEFAULT_SOUL_MD, _ensure_default_soul_md, ensure_hermes_home
from hermes_cli.config_home import initialize_home

_SUBDIRS = ("cron", "sessions", "logs", "memories")


@pytest.mark.parametrize("target", ["SOUL.md", "missing-dir/SOUL.md"], ids=["cyclic", "dangling"])
def test_initialize_home_replaces_unwritable_soul_symlink(tmp_path, target):
    home = tmp_path / ".hermes"
    home.mkdir()
    soul = home / "SOUL.md"
    soul.symlink_to(home / target)

    initialize_home(home, _SUBDIRS, set())

    assert not soul.is_symlink()
    assert soul.read_text(encoding="utf-8") == DEFAULT_SOUL_MD
    assert not [p for p in home.iterdir() if p.name.startswith(".SOUL.md.")]


def test_soul_symlink_to_customized_file_is_left_alone(tmp_path):
    """Control: a resolving link survives and its content is untouched."""
    home = tmp_path / ".hermes"
    home.mkdir()
    target = tmp_path / "shared-identity.md"
    target.write_text("custom identity\n", encoding="utf-8")
    soul = home / "SOUL.md"
    soul.symlink_to(target)

    _ensure_default_soul_md(home)
    initialize_home(home, _SUBDIRS, set())

    assert soul.is_symlink()
    assert soul.read_text(encoding="utf-8") == "custom identity\n"


class TestEnsureHermesHome:

    def test_creates_default_soul_md_if_missing(self, tmp_path):
        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            ensure_hermes_home()
            soul_path = tmp_path / "SOUL.md"
            assert soul_path.exists()
            assert soul_path.read_text(encoding="utf-8").strip() != ""


    def test_upgrades_legacy_template_soul_md(self, tmp_path):
        # Older installers seeded a comment-only scaffold that shadowed the
        # runtime default. A SOUL.md still matching that scaffold carries no
        # user persona and should be upgraded in place to DEFAULT_SOUL_MD.
        from hermes_cli.default_soul import DEFAULT_SOUL_MD, _LEGACY_TEMPLATE_SOULS

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(_LEGACY_TEMPLATE_SOULS[0] + "\n", encoding="utf-8")
            ensure_hermes_home()
            assert soul_path.read_text(encoding="utf-8") == DEFAULT_SOUL_MD

    # The pre-#95681 DEFAULT_SOUL_MD text, hardcoded (not read from the
    # module) so this fixture keeps testing the OLD text regardless of any
    # future change to _LEGACY_TEMPLATE_SOULS's length or ordering.
    _PRE_REWRITE_DEFAULT_SOUL = (
        "You are Hermes Agent, an intelligent AI assistant created by Nous "
        "Research. You are helpful, knowledgeable, and direct. You assist "
        "users with a wide range of tasks including answering questions, "
        "writing and editing code, analyzing information, creative work, "
        "and executing actions via your tools. You communicate clearly, "
        "admit uncertainty when appropriate, and prioritize being "
        "genuinely useful over being verbose unless otherwise directed "
        "below. Be targeted and efficient in your exploration and "
        "investigations."
    )

    # The currently shipped Hermes default.  It is hardcoded so this fixture
    # continues to represent the pre-branding file after DEFAULT_SOUL_MD is
    # changed to the Aino identity.
    _PRE_BRANDING_DEFAULT_SOUL = (
        "You are Hermes Agent, built by Nous Research. Be direct: match the "
        "length of your reply to the weight of the ask — a one-line question "
        "gets a one-line answer, and finished work gets a short report of what "
        "changed, what's verified, and what's left, never a replay of the "
        "process. No filler (\"Great question,\" \"I'd be happy to\"), no "
        "restating the request back, no re-summarizing what you already said, "
        "no narrating tool calls the user can see. Plain claims over "
        "adjectives; when unsure, say so plainly. Agree because it's right, "
        "not because the user said it. Depth is earned — give it when the "
        "user asks for detail, teaches, or the stakes demand it, not by "
        "default."
    )

    def test_upgrades_pre_branding_default_soul_md(self, tmp_path):
        """An untouched Hermes default becomes the Aino default in place."""
        from hermes_cli.default_soul import DEFAULT_SOUL_MD

        assert self._PRE_BRANDING_DEFAULT_SOUL != DEFAULT_SOUL_MD

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(self._PRE_BRANDING_DEFAULT_SOUL, encoding="utf-8")
            ensure_hermes_home()
            assert soul_path.read_text(encoding="utf-8") == DEFAULT_SOUL_MD

    def test_upgrades_ascii_pre_branding_default_soul_md(self, tmp_path):
        """The ASCII Windows installer generation also migrates safely."""
        from hermes_cli.default_soul import DEFAULT_SOUL_MD

        ascii_legacy = self._PRE_BRANDING_DEFAULT_SOUL.replace("—", "--")

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(ascii_legacy, encoding="utf-8")
            ensure_hermes_home()
            assert soul_path.read_text(encoding="utf-8") == DEFAULT_SOUL_MD

    def test_does_not_upgrade_customized_pre_branding_default(self, tmp_path):
        """Adding user text to the old default must prevent an overwrite."""
        from hermes_cli.default_soul import DEFAULT_SOUL_MD

        customized = self._PRE_BRANDING_DEFAULT_SOUL + "\nAlways answer in Chinese."

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(customized, encoding="utf-8")
            ensure_hermes_home()
            assert soul_path.read_text(encoding="utf-8") == customized
            assert customized != DEFAULT_SOUL_MD

    def test_upgrades_pre_rewrite_default_soul_md(self, tmp_path):
        # Every install seeded between the old DEFAULT_SOUL_MD's introduction
        # and its #95681 rewrite got the old text auto-written on first run —
        # not user-authored, so it's just as safe to upgrade in place as the
        # comment-only scaffolds above. Regression test for that upgrade path.
        from hermes_cli.default_soul import DEFAULT_SOUL_MD

        assert self._PRE_REWRITE_DEFAULT_SOUL != DEFAULT_SOUL_MD  # sanity: fixture predates the rewrite

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(self._PRE_REWRITE_DEFAULT_SOUL, encoding="utf-8")
            ensure_hermes_home()
            assert soul_path.read_text(encoding="utf-8") == DEFAULT_SOUL_MD

    def test_does_not_upgrade_user_customized_soul_md(self, tmp_path):
        # A SOUL.md that merely starts with the old default but was edited by
        # the user carries real intent and must never be silently overwritten.
        from hermes_cli.default_soul import DEFAULT_SOUL_MD

        customized = self._PRE_REWRITE_DEFAULT_SOUL + " Also: always answer in rhyming couplets."

        with patch.dict(os.environ, {"HERMES_HOME": str(tmp_path)}):
            soul_path = tmp_path / "SOUL.md"
            soul_path.write_text(customized, encoding="utf-8")
            ensure_hermes_home()
            content = soul_path.read_text(encoding="utf-8")
            assert content == customized
            assert content != DEFAULT_SOUL_MD
