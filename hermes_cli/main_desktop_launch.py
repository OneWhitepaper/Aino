"""Profile forwarding shared by source and bundled desktop launch paths."""


def _explicit_profile_args() -> list[str]:
    """``--profile <name>`` for Electron when ``-p``/``--profile`` was on argv.

    Explicit flag only. A bare `hermes desktop` must not forward the sticky CLI
    profile — Electron would persist it over the stored desktop one.
    """
    from hermes_cli.main import explicit_cli_profile

    profile = explicit_cli_profile()
    return ["--profile", profile] if profile else []
