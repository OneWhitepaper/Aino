"""Profile-aware destinations for publishing a persisted environment credential."""

import os
from collections.abc import MutableMapping


def env_publication_targets(key: str = "") -> list[MutableMapping[str, str]]:
    """The launch scope and process env, or only the routed profile's own mutable scope."""
    from agent.secret_scope import current_secret_scope, serves_routed_profile

    from hermes_constants import is_launch_only_env_key

    scope, routed = current_secret_scope(), serves_routed_profile()
    targets = [scope] if isinstance(scope, dict) else []
    if not routed and not is_launch_only_env_key(key) and (scope is None or isinstance(scope, dict)):
        targets.append(os.environ)
    return targets
