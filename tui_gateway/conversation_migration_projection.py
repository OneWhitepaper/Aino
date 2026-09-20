"""Allowlisted public legacy text; model replay dictionaries never cross this boundary."""
from __future__ import annotations


def project_public_rows(history, *, max_attachment_bytes=None):
    from agent.compaction_display import project_compaction_message_for_display
    from agent.context_compressor import is_compaction_summary_message
    from agent.conversation_compression import _extract_steer_text_from_message
    from agent.skill_commands import describe_skill_invocation
    from tui_gateway.session_history import _is_display_hidden_marker
    result = []
    for original in history:
        role = original.get('role')
        if role not in ('user', 'assistant') or original.get('display_kind') in ('hidden', 'auto_continue'):
            continue
        projected = project_compaction_message_for_display(original)
        if projected is None:
            continue
        if is_compaction_summary_message(original):
            # A carried ask needs its authentic original row; a carrier ID cannot stand in for it.
            raise ValueError('compaction carrier has public text without provable original row provenance')
        text = projected.get('content')
        attachments = []
        if isinstance(text, list):
            parts = []
            for index, part in enumerate(text):
                if isinstance(part, dict) and part.get('type') == 'text':
                    parts.append(part.get('text', ''))
                elif role == 'user' and isinstance(part, dict) and part.get('type') == 'image_url':
                    image_url = part.get('image_url')
                    url = image_url.get('url') if isinstance(image_url, dict) else None
                    import re
                    match = re.fullmatch(r'data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)', url or '')
                    if not match:
                        raise ValueError('legacy image bytes are unavailable; keep this history read-only')
                    mime_type, data = match.groups()
                    if max_attachment_bytes is None:
                        raise ValueError('attachment preflight limit is required')
                    from .conversation_attachments import validate_attachment_bytes
                    validate_attachment_bytes(data, mime_type, max_bytes=max_attachment_bytes)
                    attachments.append({'filename': f'legacy-{original["_row_id"]}-{index}.{mime_type.split("/")[1]}',
                                        'mime_type': mime_type, 'data_base64': data})
                else:
                    raise ValueError('legacy attachment provenance is unavailable; keep this history read-only')
            text = '\n'.join(parts)
        if not isinstance(text, str) or (not text.strip() and not attachments) or _is_display_hidden_marker(role, text):
            continue
        if role == 'user':
            if text.lstrip().startswith('[System note:'):
                continue
            text = describe_skill_invocation(text, separator=' ') or _extract_steer_text_from_message(projected) or text
        result.append({'source_row_id': original['_row_id'], 'role': role,
                       'text': text, 'timestamp': original.get('timestamp'), 'attachments': attachments})
    return result
