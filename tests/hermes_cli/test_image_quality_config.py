"""Image quality uses the existing atomic, profile-scoped model preference."""
import json

import pytest
import hermes_yaml as yaml

from tests.hermes_cli import test_image_model_activation

image_settings = test_image_model_activation.image_settings


def test_quality_selection_and_clear_round_trip_in_only_the_requested_profile(image_settings):
    client, homes, writes = image_settings
    before = (homes['default'] / 'config.yaml').read_text()
    url = '/api/tools/toolsets/image_gen/model?profile=work'
    selection = {'provider': 'Aino', 'model': 'selected-image', 'activate': True}
    response = client.put(url, json={**selection, 'quality': 'high'})
    assert response.status_code == 200, response.text
    assert len(writes) == 1
    assert writes[0]['image_gen'] == {'provider': 'aino', 'model': 'selected-image', 'quality': 'high'}
    catalog = client.get('/api/tools/toolsets/image_gen/models?provider=Aino&profile=work').json()
    assert catalog['quality_configurable'] is True
    assert catalog['current'] == 'selected-image'
    assert catalog['quality'] == 'high'
    assert writes[0]['model']['default'] == 'work-chat'
    response = client.put(url, json={**selection, 'quality': None})
    assert response.status_code == 200, response.text
    image = yaml.safe_load((homes['work'] / 'config.yaml').read_text())['image_gen']
    assert image == {'provider': 'aino', 'model': 'selected-image'}
    assert len(writes) == 2
    assert (homes['default'] / 'config.yaml').read_text() == before


@pytest.mark.parametrize('quality', ['unsupported', 1, [], {}])
def test_invalid_quality_never_writes_any_profile(image_settings, quality):
    client, homes, writes = image_settings
    before = {name: (home / 'config.yaml').read_text() for name, home in homes.items()}
    response = client.put('/api/tools/toolsets/image_gen/model?profile=work', json={
        'provider': 'Aino', 'model': 'selected-image', 'activate': True, 'quality': quality})
    assert response.status_code == 422, response.text
    assert not writes
    assert {name: (home / 'config.yaml').read_text() for name, home in homes.items()} == before


def test_legacy_client_preserves_the_saved_quality(image_settings):
    client, homes, writes = image_settings
    path = homes['work'] / 'config.yaml'
    document = yaml.safe_load(path.read_text())
    document['image_gen']['quality'] = 'high'
    path.write_text(json.dumps(document))
    response = client.put('/api/tools/toolsets/image_gen/model?profile=work', json={
        'provider': 'Aino', 'model': 'selected-image', 'activate': True})
    assert response.status_code == 200, response.text
    assert writes[0]['image_gen']['quality'] == 'high'
