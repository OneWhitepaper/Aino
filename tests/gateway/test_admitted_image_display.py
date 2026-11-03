"""A text-vision transcript displays the admitted image and caption without rewriting model history."""
from copy import deepcopy

from tests.gateway.test_prompt_attachments import _ONE_PX_PNG


def _image_turn(tmp_path, monkeypatch):
    from gateway.session_ingress_media import capture_native_media
    from hermes_state import SessionDB
    from hermes_state_runtime import admit_session_input, begin_runtime_epoch

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    image = tmp_path / 'image with spaces.png'
    image.write_bytes(_ONE_PX_PNG)
    media = capture_native_media([image])
    db = SessionDB(db_path=tmp_path / 'state.db')
    db.create_session('s', source='gui')
    db.create_session('other', source='gui')
    admission = admit_session_input(db, epoch=begin_runtime_epoch(db, instance_id='owner'),
        principal_id='owner', session_id='s', request_id='send-image', payload={
            'text': '把350改成400', 'attachments_v1': {'media': media, 'media_types': ['image/png']}})
    enriched = '[The user sent an image~ An English description]\n把350改成400'
    db.append_message('s', 'user', enriched, platform_message_id=admission['admission_id'],
                      api_content=enriched)
    return db, media[0]['path'], enriched


def test_bound_image_history_restores_the_authored_caption_and_image_only_for_display(tmp_path, monkeypatch):
    from agent.context_references import format_reference_value
    from gateway.session_controls import display_projection

    db, image, enriched = _image_turn(tmp_path, monkeypatch)
    try:
        rows = db.get_messages_as_conversation('s', include_row_ids=True)
        before = deepcopy(rows)
        # Off-turn readers may be launched under another profile; the DB owns the media scope.
        monkeypatch.setenv('HERMES_HOME', str(tmp_path / 'foreign-profile'))
        projected = display_projection(rows, tmp_path, db=db, session_id='s')
        assert projected[0]['text'] == f'把350改成400\n@image:{format_reference_value(image)}'
        assert rows == before
        assert db.get_messages('s')[0]['content'] == enriched
        assert db.get_messages('s')[0]['api_content'] == enriched
    finally:
        db.close()


def test_image_display_requires_the_exact_admission_and_session_and_keeps_native_parts(tmp_path, monkeypatch):
    from gateway.session_image_display import project_admitted_images

    db, image, _enriched = _image_turn(tmp_path, monkeypatch)
    try:
        bound = db.get_messages('s')[0]
        unbound = {**bound, 'message_id': 'no-such-admission', 'platform_message_id': 'no-such-admission'}
        native = {**bound, 'content': [{'type': 'text', 'text': 'native caption'},
                                      {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,pixels'}}]}
        assert project_admitted_images([bound], db=db, session_id='other') == [bound]
        assert project_admitted_images([unbound, native], db=db, session_id='s') == [unbound, native]
        # A changed/missing retained image never substitutes an unverified path into history.
        from pathlib import Path
        Path(image).write_bytes(b'changed')
        assert project_admitted_images([bound], db=db, session_id='s') == [bound]
    finally:
        db.close()
