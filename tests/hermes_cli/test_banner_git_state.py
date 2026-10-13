from unittest.mock import MagicMock, patch








def test_get_git_banner_state_uses_release_baseline_for_aino_fork(tmp_path):
    """A fork's ``origin/main`` is not the Hermes upstream release ref.

    Aino keeps its own repository as ``origin`` and the Nous repository as a
    fetch-only remote.  The banner must therefore anchor the displayed
    upstream SHA to the release tag that supplies the running version instead
    of counting the entire upstream history as local carried work.
    """
    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    (repo_dir / ".git" / "config").write_text("[remote \"origin\"]\n\turl = https://github.com/OneWhitepaper/Aino.git\n")

    release_ref = f"v{banner.RELEASE_DATE}^{{commit}}"
    release_sha = "a" * 40
    results = {
        ("git", "remote", "get-url", "origin"): MagicMock(
            returncode=0, stdout="https://github.com/OneWhitepaper/Aino.git\n"
        ),
        ("git", "rev-parse", "--verify", "--quiet", release_ref): MagicMock(
            returncode=0, stdout=f"{release_sha}\n"
        ),
        ("git", "rev-parse", "--short=8", release_ref): MagicMock(
            returncode=0, stdout=f"{release_sha[:8]}\n"
        ),
        ("git", "rev-parse", "--short=8", "HEAD"): MagicMock(
            returncode=0, stdout="c" * 8 + "\n"
        ),
        ("git", "rev-list", "--count", f"{release_ref}..HEAD"): MagicMock(
            returncode=0, stdout="185\n"
        ),
    }

    def fake_run(cmd, **kwargs):
        key = tuple(cmd)
        if key not in results:
            raise AssertionError(f"unexpected command: {cmd}")
        return results[key]

    with patch("hermes_cli.source_check.subprocess.run", side_effect=fake_run):
        state = banner.get_git_banner_state(repo_dir)

    assert state == {"upstream": "a" * 8, "local": "c" * 8, "ahead": 185}


def test_get_git_banner_state_falls_back_to_official_upstream_ref(tmp_path):
    """A fork without a local release tag may still have ``upstream/main``."""
    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    (repo_dir / ".git" / "config").write_text(
        "[remote \"origin\"]\n\turl = https://github.com/OneWhitepaper/Aino.git\n"
        "[remote \"upstream\"]\n\turl = https://github.com/NousResearch/hermes-agent.git\n"
    )

    release_ref = f"v{banner.RELEASE_DATE}^{{commit}}"
    results = {
        ("git", "remote", "get-url", "origin"): MagicMock(
            returncode=0, stdout="https://github.com/OneWhitepaper/Aino.git\n"
        ),
        ("git", "rev-parse", "--verify", "--quiet", release_ref): MagicMock(
            returncode=1, stdout=""
        ),
        ("git", "remote", "get-url", "upstream"): MagicMock(
            returncode=0, stdout="https://github.com/NousResearch/hermes-agent.git\n"
        ),
        ("git", "rev-parse", "--verify", "--quiet", "upstream/main"): MagicMock(
            returncode=0, stdout=f"{'b' * 40}\n"
        ),
        ("git", "rev-parse", "--short=8", "upstream/main"): MagicMock(
            returncode=0, stdout="bbbbbbbb\n"
        ),
        ("git", "rev-parse", "--short=8", "HEAD"): MagicMock(
            returncode=0, stdout="cccccccc\n"
        ),
        ("git", "rev-list", "--count", "upstream/main..HEAD"): MagicMock(
            returncode=0, stdout="4\n"
        ),
    }

    def fake_run(cmd, **kwargs):
        key = tuple(cmd)
        if key not in results:
            raise AssertionError(f"unexpected command: {cmd}")
        return results[key]

    with patch("hermes_cli.source_check.subprocess.run", side_effect=fake_run):
        state = banner.get_git_banner_state(repo_dir)

    assert state == {"upstream": "bbbbbbbb", "local": "cccccccc", "ahead": 4}


def test_get_git_banner_state_does_not_label_untrusted_fork_origin_as_upstream(tmp_path):
    """Without a release tag or official remote, suppress the misleading hash."""
    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)
    (repo_dir / ".git" / "config").write_text(
        "[remote \"origin\"]\n\turl = https://example.invalid/Aino.git\n"
    )

    results = {
        ("git", "remote", "get-url", "origin"): MagicMock(
            returncode=0, stdout="https://example.invalid/Aino.git\n"
        ),
        ("git", "rev-parse", "--verify", "--quiet", f"v{banner.RELEASE_DATE}^{{commit}}"): MagicMock(
            returncode=1, stdout=""
        ),
        ("git", "remote", "get-url", "upstream"): MagicMock(returncode=2, stdout=""),
    }

    def fake_run(cmd, **kwargs):
        key = tuple(cmd)
        if key not in results:
            raise AssertionError(f"unexpected command: {cmd}")
        return results[key]

    with patch("hermes_cli.source_check.subprocess.run", side_effect=fake_run):
        state = banner.get_git_banner_state(repo_dir)

    assert state == banner._baked_banner_state()
