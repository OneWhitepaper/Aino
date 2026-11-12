"""Built-in identity overlays follow the product; user overlays stay verbatim."""

from hermes_cli.personality import resolve_personality
from hermes_cli.product_identity import PRODUCT_NAME


def test_builtin_identity_and_same_named_user_override_use_their_own_authority():
    for name in ("pirate", "noir"):
        assert PRODUCT_NAME in resolve_personality(name)[1]
        custom = "You are Captain Hermes, the user's own character."
        cfg = {"agent": {"personalities": {name: custom}}}
        assert resolve_personality(name, cfg) == (name, custom)
