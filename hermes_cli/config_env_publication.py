"""Profile-aware destinations for publishing a persisted environment credential."""

import os
from collections.abc import MutableMapping


def env_publication_targets() -> list[MutableMapping[str, str]]:
    """The launch scope and process env, or only the routed profile's own mutable scope."""
    from agent.secret_scope import current_secret_scope, serves_routed_profile

    scope, routed = current_secret_scope(), serves_routed_profile()
    targets = [scope] if isinstance(scope, dict) else []
    if not routed and (scope is None or isinstance(scope, dict)):
        targets.append(os.environ)
    return targets
