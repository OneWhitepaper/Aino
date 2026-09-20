"""Gate new conversation work on the live install owners' existing heartbeat evidence."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys

import psutil

from gateway.hosted_rooms import HostedRoomError
from hermes_state_holders import canonical_sqlite_path


class ConversationUpgradeRequired(HostedRoomError):
    pass


def backend_capabilities():
    return {'hosted_room_purposes':['discussion','conversation'],'conversation_protocol_version':1}


def _heartbeats(root):
    from hermes_cli.sqlite_safe_read import connect_tracked
    paths=[root/'state.db',*sorted((root/'profiles').glob('*/state.db'))]
    for path in paths:
        if not path.is_file():
            continue
        try:
            with closing(connect_tracked(f'{path.resolve().as_uri()}?mode=ro',uri=True,timeout=1)) as conn:
                conn.row_factory=sqlite3.Row
                columns={row[1] for row in conn.execute('PRAGMA table_info(gateway_heartbeats)')}
                if not columns:
                    continue
                birth='process_started_at' if 'process_started_at' in columns else 'NULL AS process_started_at'
                caps='capabilities_json' if 'capabilities_json' in columns else "'{}' AS capabilities_json"
                yield from (dict(row) for row in conn.execute(
                    f'SELECT backend_id,pid,started_at,host,{birth},{caps} FROM gateway_heartbeats'))
        except sqlite3.Error as exc:
            raise ConversationUpgradeRequired('Cannot verify installed backend compatibility; retry after other backends settle') from exc


def _writable_holders(path):
    names={canonical_sqlite_path(str(path.resolve())+suffix) for suffix in ('','-wal','-shm','-journal')}
    if sys.platform=='darwin':
        from hermes_state_dbfile import _iter_darwin_fd_targets
        rows=((pid,target,writable) for pid,_fd,target,_identity,writable in
              _iter_darwin_fd_targets(include_write_access=True))
    elif sys.platform.startswith('linux'):
        from hermes_state_dbfile import _iter_proc_fd_targets
        rows=((pid,target,writable) for pid,target,_fd,writable in _iter_proc_fd_targets(include_write_access=True))
    else:
        def portable():
            username=psutil.Process().username()
            for process in psutil.process_iter(['pid','username']):
                if process.pid==os.getpid():
                    continue
                try:
                    for entry in process.open_files():
                        yield process.pid,entry.path,None
                except psutil.NoSuchProcess:
                    continue
                except psutil.AccessDenied as exc:
                    if process.info.get('username') in (None,username):
                        raise ConversationUpgradeRequired('Cannot inspect a same-owner database holder') from exc
        rows=portable()
    try:
        return {pid for pid,target,writable in rows if pid!=os.getpid() and writable is not False
                and canonical_sqlite_path(target) in names}
    except OSError as exc:
        raise ConversationUpgradeRequired('Cannot inspect installed backend database holders') from exc


def require_compatible_backends(db_path):
    path=Path(db_path)
    compatible=set()
    host=os.uname().nodename if hasattr(os,'uname') else 'host'
    for row in _heartbeats(path.parent):
        if row['pid']==os.getpid():
            continue  # This call is itself the current backend's capability implementation.
        if row['host'] and row['host']!=host:
            raise ConversationUpgradeRequired('Shared conversation storage requires local, upgraded backend owners')
        try:
            birth=psutil.Process(row['pid']).create_time()
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied as exc:
            raise ConversationUpgradeRequired('Cannot verify an installed backend process identity') from exc
        stamped=row['process_started_at']
        if stamped is not None and abs(stamped-birth)>.01:
            continue  # A reused PID cannot inherit another process's capability declaration.
        if stamped is None and birth>row['started_at']+1:
            continue
        try:
            caps=json.loads(row['capabilities_json'])
        except (ValueError,TypeError):
            caps={}
        purposes=caps.get('hosted_room_purposes') if isinstance(caps,dict) else None
        if (stamped is None or not isinstance(caps,dict)
                or type(caps.get('conversation_protocol_version')) is not int or caps['conversation_protocol_version']!=1
                or not isinstance(purposes,list) or not all(isinstance(p,str) for p in purposes)
                or not {'discussion','conversation'}.issubset(purposes)):
            raise ConversationUpgradeRequired('Upgrade and restart all running backend owners before creating or continuing conversations')
        compatible.add(row['pid'])
    if _writable_holders(path)-compatible:
        raise ConversationUpgradeRequired('An unverified process holds conversation storage; close or upgrade that owner before continuing')
