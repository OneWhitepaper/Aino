"""Desired model choices follow one conversation, never a reset or independent branch."""
import json

import pytest

from hermes_state import SessionDB


@pytest.mark.parametrize('boundary', ['compression', 'reset', 'branch'])
def test_model_selection_follows_compression_but_not_a_new_conversation(tmp_path, boundary):
    selection = {'scope': {'owner_subject': 'local-owner'},
                 'selection': {'model_id': 'selected-model', 'model_source': 'aino', 'provider': 'aino',
                               'owner': {'platform_origin': 'https://models.example.test', 'user_id': 'one'}}}
    path = tmp_path / 'state.db'
    db = SessionDB(path)
    try:
        db.create_session('parent', source='gui', model='original',
                          model_config={'conversation_model_selection': selection})
        marker = {'compression': '_compressed_from', 'reset': '_reset_from', 'branch': '_branched_from'}[boundary]
        db.publish_compression_child(parent_session_id='parent', child_session_id='child', source='gui',
                                     messages=[{'role': 'assistant', 'content': 'summary'}], model='original',
                                     model_config={marker: 'parent'}, require_compression_lease=False)
    finally:
        db.close()
    reopened = SessionDB(path)
    try:
        saved = json.loads(reopened.get_session('child')['model_config'])
        if boundary == 'compression':
            assert saved['conversation_model_selection'] == selection
        else:
            assert 'conversation_model_selection' not in saved
    finally:
        reopened.close()
