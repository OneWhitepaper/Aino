"""New conversations observe tool configuration without retaining boot-time availability."""

from copy import deepcopy
import json
from pathlib import Path

import pytest


@pytest.fixture
def image_profiles(tmp_path, monkeypatch):
    from hermes_cli.config import atomic_config_replace

    launch = tmp_path / '.hermes'
    work = launch / 'profiles' / 'work'
    work.mkdir(parents=True)
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    monkeypatch.setenv('HERMES_HOME', str(launch))
    for home in (launch, work):
        atomic_config_replace(home / 'config.yaml', {'nous': {'guest': False}, 'image_gen': {'provider': 'aino'}})
    return launch, work


def image_definitions():
    from model_tools import get_tool_definitions

    return get_tool_definitions(enabled_toolsets=['image_gen'], quiet_mode=True, skip_tool_search_assembly=True)


def test_image_model_selection_is_available_immediately_in_only_its_profile(image_profiles):
    from fastapi.testclient import TestClient
    from hermes_cli.web_routers import tools
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from tools.image_generation_tool import check_image_generation_requirements
    from tools.registry import get_cached_check_fn_result

    with tools._profile_scope('work'):
        prior = image_definitions()
    assert prior == []
    assert image_definitions() == []
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    result = client.put('/api/tools/toolsets/image_gen/model?profile=work', json={
        'provider': 'Aino', 'model': 'configured-image', 'activate': True})
    assert result.status_code == 200, result.text
    with tools._profile_scope('work'):
        assert get_cached_check_fn_result(check_image_generation_requirements) is None
        current = image_definitions()
        assert get_cached_check_fn_result(check_image_generation_requirements) is True
    assert {tool['function']['name'] for tool in current} == {'image_generate'}
    assert image_definitions() == []
    assert prior == []


@pytest.mark.parametrize('writer', ['save', 'replace', 'external'])
def test_config_change_reprobes_without_mutating_previously_assembled_tools(image_profiles, writer):
    from hermes_cli.config import atomic_config_replace, load_config, save_config
    from tools.image_generation_tool import check_image_generation_requirements
    from tools.registry import get_cached_check_fn_result

    home, _ = image_profiles
    config = load_config()
    config['image_gen']['model'] = 'configured-image'
    save_config(config)
    prior = image_definitions()
    assert {tool['function']['name'] for tool in prior} == {'image_generate'}
    assert get_cached_check_fn_result(check_image_generation_requirements) is True
    original = deepcopy(prior)
    config['image_gen']['provider'] = 'unavailable-backend'
    if writer == 'save':
        save_config(config)
    elif writer == 'replace':
        atomic_config_replace(home / 'config.yaml', config)
    else:
        (home / 'config.yaml').write_text(json.dumps(config))
    assert get_cached_check_fn_result(check_image_generation_requirements) is None
    assert image_definitions() == []
    assert prior == original
