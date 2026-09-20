"""Root-scoped managed mutation permits; snapshots never wait while holding SQLite locks."""
from __future__ import annotations

import errno
import functools
import inspect
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
import time
from contextlib import closing, contextmanager, nullcontext


class MaintenanceTimeout(TimeoutError):
    pass


class MaintenanceRecoveryRequired(RuntimeError):
    pass


_local = threading.local()
_handles = set()
_handles_lock = threading.Lock()


def _lock(handle, exclusive):
    if os.name != 'nt':
        import fcntl
        fcntl.flock(handle.fileno(), (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
        return
    import ctypes
    import msvcrt
    from ctypes import wintypes
    class Overlapped(ctypes.Structure):
        _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t),
                    ('Offset', wintypes.DWORD), ('OffsetHigh', wintypes.DWORD), ('hEvent', wintypes.HANDLE)]
    operation = ctypes.windll.kernel32.LockFileEx
    operation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
                          wintypes.DWORD, ctypes.POINTER(Overlapped)]
    operation.restype = wintypes.BOOL
    if not operation(msvcrt.get_osfhandle(handle.fileno()), 1 | (2 if exclusive else 0), 0, 1, 0, ctypes.byref(Overlapped())):
        error = ctypes.windll.kernel32.GetLastError()
        if error == 33:
            raise BlockingIOError(errno.EAGAIN, 'maintenance permit is held')
        raise ctypes.WinError(error)


@contextmanager
def _permit(root, *, exclusive, timeout):
    if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout < 0:
        raise ValueError('maintenance timeout must be finite and nonnegative')
    root = Path(root).expanduser().resolve()
    key = str(root)
    state = getattr(_local, 'held', None)
    if state is None or getattr(_local, 'pid', None) != os.getpid():
        state = _local.held = {}
        _local.pid = os.getpid()
    prior = state.get(key)
    if prior:
        if exclusive and not prior[0]:
            raise RuntimeError('cannot upgrade a managed permit to a snapshot permit')
        yield
        return
    root.mkdir(parents=True, exist_ok=True)
    handle = open(root / '.conversation-maintenance.lock', 'a+b')
    with _handles_lock:
        _handles.add(handle)
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                _lock(handle, exclusive)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise MaintenanceTimeout('conversation maintenance permit timed out') from None
                time.sleep(min(.025, max(0, deadline - time.monotonic())))
        state[key] = (exclusive, handle)
        try:
            if not exclusive and (root / '.conversation-restore.json').exists():
                raise MaintenanceRecoveryRequired('conversation restore recovery is required')
            yield
        finally:
            state.pop(key, None)
    finally:
        # Closing releases the OS lock even on exceptions/process termination; never unlink its inode.
        with _handles_lock:
            _handles.discard(handle)
            handle.close()


def managed_operation(root: Path, *, timeout: float = 30.0):
    return _permit(root, exclusive=False, timeout=timeout)


def snapshot_operation(root: Path, *, timeout: float = 30.0):
    return _permit(root, exclusive=True, timeout=timeout)


def _root(value):
    if isinstance(value, (str, Path)):
        return Path(value).resolve().parent
    for attr in ('db_path', '_conversation_db_path'):
        path = getattr(value, attr, None)
        if path:
            return Path(path).resolve().parent
    store = getattr(value, 'store', None) or getattr(value, 'service', None)
    if store is not None:
        return _root(store)
    raise ValueError('managed operation requires an explicit shared database root')


def managed_call(function):
    """For conversation-only entry points; acquire before their service/runtime locks."""
    signature = inspect.signature(function)
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        values = signature.bind(*args, **kwargs).arguments
        if function.__name__ == '__init__':
            candidate = next(value for key, value in values.items() if key in ('db_path', 'store', 'server', 'service'))
            if 'db_path' in values:
                candidate = values['db_path']
        else:
            candidate = next(iter(values.values()))
        with managed_operation(_root(candidate)):
            return function(*args, **kwargs)
    return wrapped


def managed_store(cls):
    """Fence public store operations, including schema initialization, before their transactions."""
    for name, method in tuple(vars(cls).items()):
        if inspect.isfunction(method) and (not name.startswith('_') or name == '__init__'):
            setattr(cls, name, managed_call(method))
    return cls


def room_operation(db_path, room_id=None, *, purpose=None):
    if purpose == 'conversation':
        return managed_operation(_root(db_path))
    path = Path(db_path)
    if room_id is not None and path.is_file():
        with closing(sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro', uri=True, timeout=.1)) as conn:
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_rooms'").fetchone() and any(
                    row[1] == 'purpose' for row in conn.execute('PRAGMA table_info(hosted_rooms)')):
                row = conn.execute('SELECT purpose FROM hosted_rooms WHERE room_id=?', (room_id,)).fetchone()
                if row and row[0] == 'conversation':
                    return managed_operation(_root(db_path))
    return nullcontext()


def room_call(function):
    signature = inspect.signature(function)
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        values = signature.bind(*args, **kwargs).arguments
        identity = values.get('identity') or values.get('lease') or values.get('attempt')
        if hasattr(identity, 'identity'):
            identity = identity.identity
        room_id = values.get('room_id') or getattr(identity, 'room_id', None)
        with room_operation(values['db_path'], room_id, purpose=values.get('purpose')):
            return function(*args, **kwargs)
    return wrapped


def managed_runtime_call(function):
    @functools.wraps(function)
    def wrapped(runtime, binding, *args, **kwargs):
        with room_operation(runtime.db_path, binding.room_id):
            return function(runtime, binding, *args, **kwargs)
    return wrapped


def _after_fork():
    global _handles_lock
    for handle in tuple(_handles):
        handle.close()
    _handles.clear()
    _handles_lock = threading.Lock()
    _local.held = {}
    _local.pid = os.getpid()


if hasattr(os, 'register_at_fork'):
    os.register_at_fork(before=lambda: _handles_lock.acquire(), after_in_parent=lambda: _handles_lock.release(),
                        after_in_child=_after_fork)


def session_operation(db, session_id, *, force=False):
    home = Path(db.db_path).resolve().parent
    root = home.parent.parent if home.parent.name == 'profiles' else home
    if not force and not (root / 'shared-state.db').exists() and not (root / '.conversation-restore.json').exists():
        return nullcontext()
    # This can run inside the token writer: get_session() flushes that same queue
    # and would wait for itself. Identity inspection must be a non-draining read.
    row = db._read_one('SELECT model_config FROM sessions WHERE id=?', (session_id,)) if session_id else None
    config = row['model_config'] if row else '{}'
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except (ValueError, TypeError):
            config = {}
    managed = isinstance(config, dict) and isinstance(config.get('conversation_binding'), dict)
    if not managed and hasattr(db, 'get_session_migration') and session_id:
        managed = db.get_session_migration(session_id) is not None
    return managed_operation(root) if managed or force else nullcontext()


def managed_session_call(function):
    signature = inspect.signature(function)
    @functools.wraps(function)
    def wrapped(db, *args, **kwargs):
        values = signature.bind(db, *args, **kwargs).arguments
        session_id = values.get('session_id') or values.get('parent_session_id')
        options = values.get('kwargs', {})
        config = values.get('model_config') or options.get('model_config') or {}
        if isinstance(config, str):
            try:
                config = json.loads(config)
            except ValueError:
                config = {}
        managed = isinstance(config, dict) and isinstance(config.get('conversation_binding'), dict)
        with session_operation(db, session_id, force=managed or values.get('conversation_input') is not None):
            return function(db, *args, **kwargs)
    return wrapped


def managed_schema_call(function):
    @functools.wraps(function)
    def wrapped(db, *args, **kwargs):
        home = Path(db.db_path).resolve().parent
        root = home.parent.parent if home.parent.name == 'profiles' else home
        # Ordinary isolated Profiles do not participate in an install-wide snapshot.
        # A shared conversation store or restore marker establishes that boundary.
        permit = managed_operation(root) if ((root / 'shared-state.db').exists()
            or (root / '.conversation-restore.json').exists()) else nullcontext()
        with permit:
            return function(db, *args, **kwargs)
    return wrapped
