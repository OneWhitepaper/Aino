"""Shared identity preserves exact independent Profile registration ownership."""
import pytest
from hermes_cli import projects_db
from hermes_cli.projects_shared import SharedProjectStore


def test_shared_index_aggregates_only_same_environment_and_keeps_immutable_sources(tmp_path):
    index = SharedProjectStore(tmp_path / 'shared-state.db')
    directory = tmp_path / 'book'
    directory.mkdir()
    records = []
    for profile, environment in [('writer', 'local'), ('reviewer', 'local'), ('ops', 'ssh-other')]:
        with projects_db.connect_closing(tmp_path / profile / 'projects.db') as conn:
            pid = projects_db.create_project(conn, name='Book', primary_path=str(directory))
        records.append(index.register(install_id='host', environment_id=environment,
            canonical_path=str(directory.resolve()), registration_profile=profile, source_project_id=pid, name='Book'))
    assert records[0].id == records[1].id != records[2].id
    assert {s.registration_profile for s in index.list_sources(records[0].id)} == {'writer', 'reviewer'}
    source = index.list_sources(records[0].id)[0]
    with pytest.raises(ValueError, match='cannot be rebound'):
        index.register(install_id='host', environment_id='local', canonical_path=str(tmp_path / 'other'),
            registration_profile=source.registration_profile, source_project_id=source.project_id, name='Other')
    assert SharedProjectStore(index.db_path).resolve(records[0].id) == index.resolve(records[0].id)
