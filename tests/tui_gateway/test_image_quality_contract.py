"""Only declared image quality levels cross the credential binding seam."""
from datetime import UTC, datetime, timedelta

import pytest

from tui_gateway.contracts.aino_platform import ManagedCapabilities
from tui_gateway.methods_managed_model import _binding


def params(options, purpose='image'):
    return {
        'owner': {'platform_origin': 'https://account.example', 'user_id': 'account'},
        'purpose': purpose, 'model_id': 'image', 'model': 'image-wire',
        'api_mode': 'images_generations' if purpose == 'image' else 'chat_completions',
        'capabilities': {'tools': True, 'vision': False, 'reasoning': False,
                         'image_generation': purpose == 'image', 'image_quality_options': options},
        'credential_id': 'id', 'api_key': 'secret', 'base_url': 'https://account.example/v1',
        'expires_at': (datetime.now(UTC) + timedelta(minutes=5)).isoformat(), 'binding_revision': 1}


def test_quality_levels_survive_the_wire_and_binding():
    capabilities = params(['auto', 'high'])['capabilities']
    wire = ManagedCapabilities.model_validate(capabilities).model_dump()
    binding = _binding({**params([]), 'capabilities': wire}, 's')
    assert binding.capabilities['image_quality_options'] == ['auto', 'high']
    assert binding.capabilities['reasoning'] is False


@pytest.mark.parametrize('options,purpose', [
    (['high', 'high'], 'image'), (['unknown'], 'image'), ('high', 'image'),
    ([1], 'image'), (None, 'image'), (['high'], 'chat')])
def test_malformed_or_text_quality_capabilities_are_rejected(options, purpose):
    with pytest.raises(ValueError):
        _binding(params(options, purpose), 's')
