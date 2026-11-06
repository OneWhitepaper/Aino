"""Publish verified immutable media without exposing partial final files."""
from __future__ import annotations

import os
from pathlib import Path
import tempfile
import uuid

from hermes_cli.cloud_sync_portable import AttachmentTooLarge, _open_regular, read_owned, safe_child


def publish_media(home, path, data):
    path = safe_child(home, *Path(path).relative_to(home).parts)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        if read_owned(path, (home,)) == data:
            return
    except (FileNotFoundError, AttachmentTooLarge):
        pass
    # Unlike utils.atomic_replace, replacing this name must never follow a link.
    if os.open in os.supports_dir_fd and os.rename in os.supports_dir_fd:
        directory = _open_regular(path.parent)
        temporary = '.sync-' + uuid.uuid4().hex
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
            os.fsync(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
            os.close(directory)
    else:
        _publish_path(path, data)


def _publish_path(path, data):
    from utils import fsync_directory
    fd, temporary = tempfile.mkstemp(prefix='.sync-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
