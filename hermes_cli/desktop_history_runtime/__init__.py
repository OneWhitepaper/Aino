"""Bounded recovery of selected desktop Code files.

``code`` owns the migration API, ``rollouts`` validates native thread logs,
``workspaces`` maps session-owned work, and ``files`` guards filesystem I/O.
``execution`` projects portable launch choices for the main recovery flow.
Account ownership approval belongs to the caller, before invoking this package.
"""

from hermes_cli.desktop_history_runtime.code import migrate_code_files

__all__ = ["migrate_code_files"]
