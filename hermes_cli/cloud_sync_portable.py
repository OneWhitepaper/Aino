"""Canonical, explicitly portable history and owned media for cloud sync."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid

MAX_BLOB = 8 * 1024 * 1024
MAX_DOCUMENT = 8 * 1024 * 1024
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
SESSION_FIELDS = (
    'id', 'source', 'model', 'started_at', 'ended_at', 'end_reason', 'parent_session_id',
    'title', 'archived', 'auto_archived', 'pinned', 'hidden', 'input_tokens', 'output_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'api_call_count',
)
MODEL_FIELDS = ('model', 'provider', 'temperature', 'max_tokens', 'reasoning_effort',
                'model_source', 'model_id', 'api_mode', 'platform_owner', '_branched_from', '_delegate_from', '_reset_from')
META_FIELDS = ('description', 'description_auto', 'display_name', 'previous_names')
MEDIA_FIELDS = {'image', 'image_url', 'image_path', 'audio_path', 'video_path', 'agent_visible_image'}
PATH_FIELDS = {'url', 'path', 'file_path', 'local_path', *MEDIA_FIELDS}
MEDIA_SUFFIXES = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf', '.mp3', '.wav', '.ogg', '.mp4', '.webm'}
MEDIA_DIRS = ('images', 'attachments', 'uploads', 'image_cache', 'audio_cache', 'video_cache',
              'cache/generated', 'cache/images', 'cache/vision', 'cache/video', 'cache/videos', 'cache/audio',
              'cloud-sync/media')
REFERENCE_PATTERNS = (
    re.compile(r'(!?\[[^\]\n]*\]\()((?:file://)?/[^)\n]+|cloud-blob:[a-f0-9]{64})(\))'),
    re.compile(r'(image_url: )((?:file://)?/[^\]\n]+|cloud-blob:[a-f0-9]{64})(?=\])'),
    re.compile(r'((?:MEDIA:|@file:))((?:file://)?/[^\s<>]+|cloud-blob:[a-f0-9]{64})'),
)


class AttachmentTooLarge(ValueError):
    reason = 'attachment_too_large'


def dumps(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(dumps(value).encode()).hexdigest()


def safe_child(root, *parts):
    """Reject symlinked components, including private destinations already on disk."""
    root = Path(root)
    if root.is_symlink():
        raise ValueError('symlinked account root')
    root = root.resolve()
    target = root.joinpath(*parts)
    if not target.is_relative_to(root):
        raise ValueError('path escapes account home')
    current = root
    for part in target.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('symlinked account path')
    return target


def read_owned(path, roots):
    path = Path(path)
    root = next((r for r in roots if path.is_relative_to(r)), None)
    if root is None:
        raise ValueError('attachment is outside owned directories')
    safe_child(root, *path.relative_to(root).parts)
    # Walk descriptors, so replacing an intermediate directory with a symlink cannot
    # redirect the read between validation and open. Windows refuses symlinks above.
    fd = _open_regular(path)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('attachment is not a regular file')
        if info.st_size > MAX_BLOB:
            raise AttachmentTooLarge('attachment exceeds 8 MiB')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            content = stream.read(MAX_BLOB + 1)
        if len(content) > MAX_BLOB:
            raise AttachmentTooLarge('attachment exceeds 8 MiB')
        return content
    finally:
        os.close(fd)


def _open_regular(path):
    if os.open not in os.supports_dir_fd:
        return os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    parent = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        return os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    finally:
        os.close(parent)


def map_media(value, visit, field='', media_context=False):
    if isinstance(value, dict):
        media_context |= value.get('type') in ('image', 'image_url', 'input_image', 'file', 'audio', 'video')
        return {k: v if k in ('tool_calls', 'arguments') else map_media(v, visit, k,
                media_context or k in ('attachments', 'images', 'files')) for k, v in value.items()}
    if isinstance(value, list):
        return [map_media(v, visit, field, media_context) for v in value]
    explicit = media_context or field in MEDIA_FIELDS or (isinstance(value, str) and (
        Path(value).suffix.lower() in MEDIA_SUFFIXES or any(p in Path(value).parts for p in ('attachments', 'images'))))
    if isinstance(value, str) and (value.startswith('cloud-blob:') or
            (explicit and field in PATH_FIELDS and (value.startswith('/') or value.startswith('file://')))):
        return visit(value)
    if isinstance(value, str):
        if value.startswith(('{', '[')):
            try:
                parsed = json.loads(value)
            except (ValueError, TypeError):
                parsed = None
            if isinstance(parsed, (dict, list)):
                mapped = map_media(parsed, visit, media_context=media_context)
                if mapped != parsed:
                    return dumps(mapped)
        for pattern in REFERENCE_PATTERNS:
            value = pattern.sub(lambda match: match[1] + visit(match[2]) + (match[3] if match.lastindex == 3 else ''), value)
    return value


def model_config(raw):
    raw = json.loads(raw) if isinstance(raw, str) else raw or {}
    result = {k: raw[k] for k in MODEL_FIELDS if k in raw}
    if isinstance(result.get('platform_owner'), dict):
        result['platform_owner'] = {k: result['platform_owner'][k] for k in ('platform_origin', 'user_id')
                                    if k in result['platform_owner']}
    return result


def profile_info(home, profile):
    if profile == 'default':
        return {'id': profile, 'metadata': {}, 'config': {}}
    from hermes_cli.config_backend import config_exists, read_config_doc
    from hermes_cli.profiles import read_profile_meta
    meta = read_profile_meta(home)
    metadata = {k: meta[k] for k in META_FIELDS if k in meta}
    if meta.get('bot_title'):
        metadata['bot_title'] = meta['bot_title']
    config_path = safe_child(home, 'config.yaml')
    config = read_config_doc(config_path) if config_exists(config_path) else {}
    config = config or {}
    # A profile is descriptive data. Tools, channels, skills, permissions and environment never travel.
    model = config.get('model')
    if isinstance(model, dict):
        model = {k: model[k] for k in ('provider', 'model', 'name', 'reasoning_effort') if k in model}
    return {'id': profile, 'metadata': metadata,
            'config': {'model': model} if isinstance(model, (str, dict)) else {}}


def portable_segments(db, conn, ids, home, ui_root):
    uploads = {}
    attachments = {}

    def export_media(value):
        if value.startswith('cloud-blob:'):
            sha = value.removeprefix('cloud-blob:')
            if not SHA.fullmatch(sha):
                raise ValueError('invalid attachment hash')
            path = safe_child(home, 'cloud-sync', 'media', sha)
        else:
            path = Path(value.removeprefix('file://'))
        roots = tuple(safe_child(home, *name.split('/')) for name in MEDIA_DIRS) + tuple(
            safe_child(ui_root, name) for name in ('attachments', 'media', 'uploads'))
        if path.is_relative_to(home) and any(
                part.startswith('.') or part.lower() in ('config.yaml', 'auth.json', 'credentials.json')
                for part in path.relative_to(home).parts):
            raise ValueError('secret or hidden files are not attachments')
        content = read_owned(path, roots)
        sha = hashlib.sha256(content).hexdigest()
        uploads[sha] = {'sha256': sha, 'data_base64': base64.b64encode(content).decode()}
        attachments[sha] = {'sha256': sha, 'size': len(content)}
        return 'cloud-blob:' + sha

    segments = []
    for sid in ids:
        row = conn.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if row is None:
            continue
        item = {k: row[k] for k in SESSION_FIELDS}
        if item['parent_session_id'] not in ids:
            item['parent_session_id'] = None
        item['model_config'] = model_config(row['model_config'])
        # Runtime/crash recovery is local; the transcript remains available for a new submission.
        if item['end_reason'] not in (None, 'compression'):
            item['end_reason'] = None
            item['ended_at'] = None
        rows = conn.execute('SELECT * FROM messages WHERE session_id=? ORDER BY id', (sid,)).fetchall()
        messages = [db._row_to_message_dict(r, warn_context='cloud_sync', summary_flag=True) for r in rows]
        for message in messages:
            for field in ('id', 'session_id', '_row_id'):
                message.pop(field, None)
        item['messages'] = map_media(messages, export_media)
        segments.append(item)
    return segments, list(attachments.values()), uploads


def payload(db, conn, ids, home, ui_root, profile):
    segments, attachments, uploads = portable_segments(db, conn, ids, home, ui_root)
    value = {'schema': 1, 'profile': profile_info(home, profile), 'segments': segments,
             'attachments': sorted(attachments, key=lambda a: a['sha256'])}
    if len(dumps(value).encode()) > MAX_DOCUMENT:
        raise ValueError('conversation exceeds 8 MiB document limit')
    return value, uploads


def remap_conflict(segments, key, revision):
    mapping = {s['id']: 'sync-' + hashlib.sha256(f'{key}:{revision}:{s["id"]}'.encode()).hexdigest()[:32]
               for s in segments}
    uid_mapping = {}
    for segment in segments:
        for msg in segment['messages']:
            for name in ('message_uid', 'tool_call_uid'):
                if msg.get(name):
                    uid_mapping[msg[name]] = str(uuid.uuid5(uuid.NAMESPACE_URL, f'{key}:{revision}:{msg[name]}'))
    reference_fields = {'id', 'parent_session_id', 'message_uid', 'tool_call_uid', 'tool_call_uids',
                        'absorbed_message_uids', '_branched_from', '_delegate_from', '_reset_from'}
    uid_fields = {'message_uid', 'tool_call_uid', 'tool_call_uids', 'absorbed_message_uids'}
    def remap(value, field=''):
        if isinstance(value, str):
            if field in uid_fields:
                return uid_mapping.setdefault(value, str(uuid.uuid5(uuid.NAMESPACE_URL, f'{key}:{revision}:{value}')))
            return mapping.get(value, uid_mapping.get(value, value)) if field in reference_fields else value
        if isinstance(value, list):
            return [remap(v, field) for v in value]
        if isinstance(value, dict):
            return {k: remap(v, k if field != 'tool_call_uids' else field) for k, v in value.items()}
        return value
    result = remap(segments)
    for segment in result:
        segment['title'] = (segment.get('title') or 'Conversation') + ' (sync conflict)'
        segment['hidden'] = 0
    return result
