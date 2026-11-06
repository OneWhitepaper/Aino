"""Cloud profile publication preserves metadata and device-local settings."""

import pytest
import hermes_yaml as yaml

from hermes_cli.cloud_sync_apply import publish_profile
from hermes_cli.profiles import read_profile_meta


@pytest.mark.parametrize('title', [None, 'Synced bot'])
def test_publish_profile_preserves_unowned_metadata_and_local_settings(tmp_path, title):
    profile_dir = tmp_path / 'profiles' / 'researcher'
    profile_dir.mkdir(parents=True)
    existing = {
        'description': 'Old description',
        'custom_metadata': {'local': True},
        'ui_meta': {
            'hermes-bots': {'title': 'Local bot', 'avatar': 'local-avatar'},
            'other-client': {'color': 'blue'},
        },
        '_ui_meta_revisions': {'hermes-bots': 7, 'other-client': 2},
    }
    (profile_dir / 'profile.yaml').write_text(yaml.safe_dump(existing), encoding='utf-8')
    config = '# Local settings\nmodel:\n  model: old-model\n  api_key: local-secret\nterminal:\n  cwd: /local/project\n'
    (profile_dir / 'config.yaml').write_text(config, encoding='utf-8')
    (profile_dir / '.env').write_text('API_KEY=device-secret\n', encoding='utf-8')
    metadata = {'description': 'Synced description', 'display_name': 'Researcher'}
    if title is not None:
        metadata['bot_title'] = title

    publish_profile(tmp_path, {
        'id': 'researcher', 'metadata': metadata,
        'config': {'model': {'model': 'synced-model'}},
    })

    expected = {**existing, 'description': 'Synced description', 'display_name': 'Researcher'}
    expected['ui_meta']['hermes-bots']['title'] = title or 'Local bot'
    assert yaml.safe_load((profile_dir / 'profile.yaml').read_text()) == expected
    assert read_profile_meta(profile_dir)['bot_title'] == (title or 'Local bot')
    assert yaml.safe_load((profile_dir / 'config.yaml').read_text()) == {
        'model': {'model': 'synced-model', 'api_key': 'local-secret'},
        'terminal': {'cwd': '/local/project'},
    }
    assert '# Local settings' in (profile_dir / 'config.yaml').read_text()
    assert (profile_dir / '.env').read_text() == 'API_KEY=device-secret\n'
