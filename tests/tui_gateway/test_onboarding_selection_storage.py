"""Managed onboarding stores and validates account authority through the persistence contract."""

import pytest

from persistence.conversation.sessions import NewSession
from persistence_assembly import open_persistence, profile_scope
from tui_gateway.methods_onboarding_managed import store_selection, validate_reopen


def test_managed_onboarding_preserves_selection_and_refuses_a_different_account(tmp_path):
    selected = {"model_source": "aino", "model_id": "catalog-model", "platform_owner": {
        "platform_origin": "http://127.0.0.1:1", "user_id": "account-a"}}
    with open_persistence(profile_scope(home=tmp_path)) as store:
        store.sessions.create(NewSession("onboard", "desktop"))
        store_selection(store, "onboard", selected)
        assert validate_reopen(store, "onboard", selected) == selected
        assert validate_reopen(store, "onboard", None) == selected
        with pytest.raises(ValueError, match="model or owner changed"):
            validate_reopen(store, "onboard", {**selected, "platform_owner": {
                **selected["platform_owner"], "user_id": "account-b"}})
