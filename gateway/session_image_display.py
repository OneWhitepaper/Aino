"""Authored image turns recovered from their canonical admission for display only.

Older text-vision turns persisted the model's image description as user content. The admission
retains the caption and immutable image references; its identity, never the description's wording,
is what authorizes a display projection. Durable content and API replay remain untouched.
"""
from pathlib import Path

from persistence.core.errors import AuthorityRefusal as RuntimeStoreError


def project_admitted_images(messages, *, db, session_id):
    """Add ``display_content`` only for a string user row bound to this session's image admission."""
    if db is None or not session_id:
        return messages
    owner = db.bindings.lineage_owner(session_id)
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
    from gateway.session_authority import admission_row
    admission = admission_row(db.admissions.get(admission_id=admission_id))
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
    from agent.runtime_scope import bind_profile_scope

    # History reads happen outside a turn; validation must use the store's owning profile.
    try:
        with bind_profile_scope(db.scope.profile_dir):
            paths = restore_attachments(payload)['media_urls']
    except (RuntimeStoreError, KeyError, TypeError):
        return None
    if len(paths) != len(mimes):
        return None
    return build_persist_message_with_image_refs(caption, paths)
