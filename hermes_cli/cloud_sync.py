"""Bounded, credential-free JSON entry point for the native cloud sync coordinator."""
from __future__ import annotations

import json
import logging
import sys

MAX_IO = 32 * 1024 * 1024


def dispatch(request):
    from hermes_cli.cloud_sync_engine import exchange_local
    if not isinstance(request, dict) or request.get('version') != 1:
        raise ValueError('unsupported sync request version')
    actions = {'prepare', 'apply', 'status', 'read_blob', 'rebatch'}
    if request.get('action') not in actions:
        raise ValueError('unsupported sync action')
    allowed = {'version', 'action', 'home', 'ui_root', 'request_id', 'device_id', 'response', 'blobs', 'sha256'}
    if set(request) - allowed:
        raise ValueError('unknown sync request fields')
    return exchange_local(request)


def main():
    from hermes_cli.cloud_sync_portable import dumps
    try:
        raw = sys.stdin.buffer.read(MAX_IO + 1)
        if len(raw) > MAX_IO:
            raise ValueError('sync request exceeds 32 MiB')
        result = dispatch(json.loads(raw))
        encoded = dumps(result)
        if len(encoded.encode()) > MAX_IO:
            raise ValueError('sync response exceeds 32 MiB')
    except (ValueError, TypeError, KeyError) as exc:
        encoded = dumps({'ok': False, 'error': {'code': 'invalid_request', 'message': str(exc)}})
        sys.stdout.write(encoded + '\n')
        return 1
    except Exception as exc:
        logging.getLogger(__name__).exception('cloud sync failed')
        sys.stdout.write(dumps({'ok': False, 'error': {'code': 'sync_failed', 'message': str(exc)}}) + '\n')
        return 1
    sys.stdout.write(encoded + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
