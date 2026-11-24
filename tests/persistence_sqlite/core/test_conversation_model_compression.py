"""Desired model choices follow one conversation, never a reset or independent branch."""
import json

import pytest

from persistence_assembly import open_persistence, profile_scope
from persistence.conversation.sessions import NewSession
from persistence.conversation.messages import NewMessage
from persistence.conversation.lineage import CompressionChild


@pytest.mark.parametrize('boundary', ['compression', 'reset', 'branch'])
def test_model_selection_follows_compression_but_not_a_new_conversation(tmp_path, boundary):
    selection = {'scope': {'owner_subject': 'local-owner'},
                 'selection': {'model_id': 'selected-model', 'model_source': 'aino', 'provider': 'aino',
                               'owner': {'platform_origin': 'https://models.example.test', 'user_id': 'one'}}}
    db = open_persistence(profile_scope(home=tmp_path))
    try:
        db.sessions.create(NewSession(session_id='parent', source='gui', model='original',
                          model_config={'conversation_model_selection': selection}))
        marker = {'compression': '_compressed_from', 'reset': '_reset_from', 'branch': '_branched_from'}[boundary]
        db.lineage.publish_compression_child('parent', CompressionChild(
            session_id='child', source='gui', model='original', model_config={marker: 'parent'}),
            [NewMessage(role='assistant', content='summary')], require_compression_lease=False)
    finally:
        db.close()
    reopened = open_persistence(profile_scope(home=tmp_path))
    try:
        saved = reopened.sessions.get('child').model_config
        if boundary == 'compression':
            assert saved['conversation_model_selection'] == selection
        else:
            assert 'conversation_model_selection' not in saved
    finally:
        reopened.close()
