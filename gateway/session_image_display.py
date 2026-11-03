"""Authored image turns recovered from their canonical admission for display only.

Older text-vision turns persisted the model's image description as user content. The admission
retains the caption and immutable image references; its identity, never the description's wording,
is what authorizes a display projection. Durable content and API replay remain untouched.
"""
from pathlib import Path

from hermes_state_runtime import RuntimeStoreError


def project_admitted_images(messages, *, db, session_id):
    """Add ``display_content`` only for a string user row bound to this session's image admission."""
    if db is None or not session_id:
        return messages
    from hermes_state_local import local_lineage_owner

    with db._read_ctx() as conn:
        owner = local_lineage_owner(conn, session_id)
    projected = []
    for message in messages:
        text = _admitted_image_text(message, db, owner)
        projected.append({**message, 'display_content': text} if text is not None else message)
    return projected


def _admitted_image_text(message, db, session_id):
    if (message.get('role') != 'user' or not isinstance(message.get('content'), str)
            or 'display_content' in message or message.get('display_kind')):
        return None
    admission_id = message.get('platform_message_id') or message.get('message_id')
    if not isinstance(admission_id, str) or not admission_id:
        return None
    from hermes_state_runtime import get_session_admission

    admission = get_session_admission(db, admission_id=admission_id)
    if admission is None or admission['target_session_id'] != session_id:
        return None
    payload = admission['payload']
    caption, attachments = payload.get('text'), payload.get('attachments_v1')
    if not isinstance(caption, str) or not isinstance(attachments, dict):
        return None
    mimes = attachments.get('media_types')
    if (not isinstance(mimes, list) or not mimes
            or any(not isinstance(mime, str) or not mime.startswith('image/') for mime in mimes)):
        return None
    from agent.image_routing import build_persist_message_with_image_refs
    from gateway.session_ingress_media import restore_attachments
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    # History reads happen outside a turn; validation must use the store's owning profile.
    token = set_hermes_home_override(Path(db.db_path).parent)
    try:
        paths = restore_attachments(payload)['media_urls']
    except (RuntimeStoreError, KeyError, TypeError):
        return None
    finally:
        reset_hermes_home_override(token)
    if len(paths) != len(mimes):
        return None
    return build_persist_message_with_image_refs(caption, paths)
