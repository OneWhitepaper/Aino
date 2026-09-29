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

    with patch("hermes_cli.banner.subprocess.run", side_effect=fake_run):
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

    with patch("hermes_cli.banner.subprocess.run", side_effect=fake_run):
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

    with patch("hermes_cli.banner.subprocess.run", side_effect=fake_run):
        state = banner.get_git_banner_state(repo_dir)

    assert state is None


def test_check_via_local_git_ssh_fastpath_ahead_not_behind(tmp_path):
    """SSH fast path must not report an ahead (carried) HEAD as behind.

    A carried local commit means tip SHAs differ, but the fresh upstream tip
    is an ancestor of HEAD — that is "ahead", and reporting it as behind
    nudges the user into `hermes update`, which can wipe the carried work.
    """

    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5, network=False):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:NousResearch/hermes-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40  # carried commit, differs from upstream tip
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_github_branch_tip", return_value="a" * 40),
        # merge-base --is-ancestor exits 0: upstream tip IS an ancestor of HEAD
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=0)),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == 0


def test_check_via_local_git_ssh_fastpath_genuinely_behind(tmp_path):
    """SSH fast path reports the exact count (compare API) when behind."""

    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5, network=False):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:NousResearch/hermes-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_github_branch_tip", return_value="a" * 40),
        # merge-base --is-ancestor exits 1: not an ancestor -> genuinely behind
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=1)),
        patch.object(banner, "_github_compare_behind", return_value=3),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == 3


def test_check_via_local_git_ssh_fastpath_offline_keeps_sentinel(tmp_path):
    """Behind + compare API unreachable = honest no-count sentinel, never 1."""

    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    (repo_dir / ".git").mkdir(parents=True)

    def fake_git_stdout(args, *, cwd, timeout=5, network=False):
        if args == ["remote", "get-url", "origin"]:
            return "git@github.com:NousResearch/hermes-agent.git"
        if args == ["rev-parse", "HEAD"]:
            return "b" * 40
        raise AssertionError(f"unexpected git call: {args}")

    with (
        patch.object(banner, "_git_stdout", side_effect=fake_git_stdout),
        patch.object(banner, "_github_branch_tip", return_value="a" * 40),
        patch.object(banner.subprocess, "run", return_value=MagicMock(returncode=1)),
        patch.object(banner, "_github_compare_behind", return_value=None),
    ):
        behind = banner._check_via_local_git(repo_dir)

    assert behind == banner.UPDATE_AVAILABLE_NO_COUNT


def test_check_via_local_git_insteadof_rewrite_routes_to_ssh_fastpath(tmp_path, monkeypatch):
    """#104591: the origin-URL probe must run under the fetch's config-isolated env.

    A global ``url.<https>.insteadOf`` rewrite makes a plain ``git remote get-url origin``
    report HTTPS for an SSH origin, so the SSH-avoiding fast path is skipped — while the
    fetch itself drops global config (``GIT_CONFIG_GLOBAL=/dev/null``), dials the raw SSH
    origin, and its host-key prompt opens /dev/tty and steals the CLI's keystrokes. With the
    probe under the same isolated env both sides observe the raw SSH URL and the HTTPS
    ls-remote fast path runs instead — no fetch, no ssh child.
    """
    import os
    import subprocess

    from hermes_cli import banner

    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    # Config-isolated setup so the developer's own global git config can't leak in.
    setup_env = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
    setup_cmds = [
        ["git", "init", "-q"],
        # Pinned identity: with global/system config nulled, CI runners whose bare
        # hostname makes git's auto-detected ident "user@host.(none)" reject the commit.
        ["git", "-c", "user.email=t@t", "-c", "user.name=t",
         "commit", "--allow-empty", "-q", "-m", "init"],
        ["git", "remote", "add", "origin", "git@github.com:NousResearch/hermes-agent.git"],
        ["git", "rev-parse", "HEAD"],
    ]
    head_sha = None
    for argv in setup_cmds:
        done = subprocess.run(
            argv, cwd=repo_dir, env=setup_env, check=True, capture_output=True, text=True)
        if argv[1] == "rev-parse":
            head_sha = done.stdout.strip()
    assert head_sha

    # Global config (visible only without GIT_CONFIG_GLOBAL isolation) rewrites SSH to HTTPS.
    home = tmp_path / "home"
    home.mkdir()
    (home / ".gitconfig").write_text(
        '[url "https://github.com/"]\n\tinsteadOf = git@github.com:\n', encoding="utf-8")
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))  # Git for Windows resolves global config here too

    calls = []
    real_run = banner.subprocess.run

    def spy_run(args, **kwargs):
        calls.append((list(args), kwargs))
        if args[1] in {"ls-remote", "fetch"}:
            raise AssertionError(f"a GitHub origin must be probed via the API, not git {args[1]}")
        return real_run(args, **kwargs)

    monkeypatch.setattr(banner.subprocess, "run", spy_run)
    monkeypatch.setattr(banner, "_github_branch_tip", lambda slug, branch: head_sha)

    behind = banner._check_via_local_git(repo_dir)

    # Same upstream tip as HEAD: the SSH fast path concludes "not behind".
    assert behind == 0
    assert not any(args[1] == "fetch" for args, _ in calls), (
        "insteadOf rewrite must not smuggle the check into the fetch branch")
    probe = next(
        (kwargs for args, kwargs in calls if args[1:3] == ["remote", "get-url"]), None)
    assert probe is not None
    assert probe["env"]["GIT_CONFIG_GLOBAL"] == os.devnull, (
        "the origin-URL probe must observe the URL the isolated fetch will dial")
