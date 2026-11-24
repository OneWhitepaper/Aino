"""Lock-safe inspection of SQLite database files.

POSIX advisory locks are cancelled **process-wide** by ``close()`` on *any* fd for that file, so a
bare ``open(db_path, "rb") ... close()`` on a live database drops every lock SQLite holds from this
process (a VACUUM's EXCLUSIVE lock, an in-flight BEGIN IMMEDIATE's RESERVED lock). This module
tracks live connections so raw reads happen only when none exist.
"""

from __future__ import annotations

import contextlib
import errno
import stat
import time
import logging
import os
import secrets
import sqlite3
import sys
import threading
from collections import deque
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Guards BOTH the registry and the lifecycle syscalls it describes. Reentrant
# because connect_tracked -> _canonical_db_path -> ... stays on one thread.
_live_lock = threading.RLock()
# canonical path -> number of live connections opened by this process
_live_connections: dict[str, int] = {}
# Keys whose connection SQLite has closed, queued from wherever that happened (possibly inside a
# garbage collection) and applied under _live_lock by the next registry read. Lock-free on purpose:
# a collection can run while any lock is held, so it must never wait for _live_lock.
_released: deque[str] = deque()
# Private, randomised name so no caller overloads it by accident (that would free the release
# object early, while the connection is still open).
_RELEASE_FUNCTION = f"_hermes_release_{secrets.token_hex(8)}"


class UntrackableConnectionError(RuntimeError):
    """A connection to a probe-able database could not be tracked. Raised rather than returning an
    untracked connection: on these paths tracking is part of the correctness contract."""


class LiveConnectionError(RuntimeError):
    """A raw file operation was attempted on a database with live connections."""


def _key(path: Path | str) -> str:
    """Canonicalise a *filesystem* path for use as a registry key."""
    try:
        return str(Path(path).resolve())
    except OSError:
        return str(path)


def _canonical_db_path(conn: sqlite3.Connection) -> Optional[str]:
    """The on-disk path of ``main`` as SQLite reports it (immune to ``file:`` URIs, relative paths,
    symlinks). ``None`` for in-memory/unnamed databases, which cannot be byte-probed."""
    try:
        row = conn.execute("PRAGMA database_list").fetchone()
    except sqlite3.Error:
        return None
    if not row or len(row) < 3 or not row[2]:
        return None
    return _key(row[2])


def track_connection(path: Path | str) -> None:
    """Record that this process holds a connection to *path* (prefer :func:`connect_tracked`; this
    is for callers managing their own connection objects, and for tests)."""
    with _live_lock:
        _track_key(_key(path))


def _track_key(key: str, delta: int = 1) -> None:
    """Adjust the live count for an already-canonical key (caller holds ``_live_lock``)."""
    remaining = _live_connections.get(key, 0) + delta
    if remaining > 0:
        _live_connections[key] = remaining
    else:
        _live_connections.pop(key, None)


def untrack_connection(path: Path | str) -> None:
    """Record that one connection to *path* has been closed."""
    with _live_lock:
        _track_key(_key(path), -1)


def _apply_releases() -> None:
    """Untrack every connection SQLite has finished closing (caller holds ``_live_lock``)."""
    while _released:
        _track_key(_released.popleft(), -1)


class _ReleaseOnClose:
    """Registered as a SQL function on each tracked connection, so SQLite holds the only reference.
    SQLite frees a connection's functions after it has closed the database files (btrees first,
    then the function table, in ``sqlite3LeaveMutexAndCloseZombie``; not an API promise, which
    the tests pin), so this object is released only once the descriptors are gone: after ``close()``, or when pysqlite closes a
    connection collected without it, on any thread (#149291). It only queues its key."""

    __slots__ = ("armed", "key")

    def __init__(self, key: str) -> None:
        self.key = key
        self.armed = False

    def __call__(self) -> None:
        return None

    def __del__(self) -> None:
        if self.armed and _released is not None:  # None only during interpreter teardown
            _released.append(self.key)


def _live_main_key(key: str) -> Optional[str]:
    """The tracked main-database key that makes *key* live, or ``None`` (caller holds ``_live_lock``).

    SQLite locks the main file and its WAL sidecars; a raw ``close()`` of any of those
    inodes cancels this process's POSIX locks, but the registry is keyed by the main path."""
    _apply_releases()
    if key in _live_connections:
        return key
    for suffix in ("-wal", "-shm"):
        if key.endswith(suffix) and key[:-len(suffix)] in _live_connections:
            return key[:-len(suffix)]
    return None


def has_live_connection(path: Path | str) -> bool:
    """Whether this process holds a connection to *path* (or to the database it is a sidecar of).

    Point-in-time answer: a raw open/close right after it returns ``False`` can still race a
    new connection. Hold :func:`offline_file_access` across the I/O whenever possible."""
    with _live_lock:
        return _live_main_key(_key(path)) is not None


class _TrackingMixin:
    """Untrack-on-close behaviour, mixable into any Connection subclass.

    The real ``close()`` and the unregister happen together under ``_live_lock`` so a concurrent
    probe can never observe "no live connection" while this descriptor is still open. Unregister
    runs only after the files are closed, through :class:`_ReleaseOnClose`: a failing close (e.g.
    cross-thread ProgrammingError) keeps the entry while the FD stays open (#75629).
    """

    _hermes_tracked_path: str | None = None

    def close(self) -> None:  # type: ignore[misc]
        with _live_lock:
            super().close()  # type: ignore[misc]
            self._hermes_tracked_path = None
            _apply_releases()


class TrackedConnection(_TrackingMixin, sqlite3.Connection):
    """A ``sqlite3.Connection`` that untracks its path exactly once on close (callers close in many
    places, some via ``contextlib.closing``, so counting closes by hand is unreliable)."""


_tracked_factory_cache: dict[type, type] = {}


def _tracking_factory(factory: type) -> type:
    """Return *factory* augmented with untrack-on-close. Callers legitimately pass their own
    ``Connection`` subclasses (tests simulate FTS5-less or pragma-failing runtimes); leaving them
    untracked would quietly unguard the database, so the tracking ``close()`` is mixed in."""
    if factory is sqlite3.Connection:
        return TrackedConnection
    if issubclass(factory, _TrackingMixin):
        return factory
    cached = _tracked_factory_cache.get(factory)
    if cached is None:
        cached = type(f"Tracked{factory.__name__}", (_TrackingMixin, factory), {})
        _tracked_factory_cache[factory] = cached
    return cached


def connect_tracked(
    path: Path | str, *, tracking_path: Path | str | None = None, connect_fn=None, **kwargs,
) -> sqlite3.Connection:
    """``sqlite3.connect`` that registers the connection for the lifetime of the fd (released on
    ``close()``). Use for any database that might be byte-probed (``state.db``, ``kanban.db``).
    Open and registration happen together under ``_live_lock`` so a concurrent
    :func:`read_header_bytes_preopen` cannot slip between them and cancel this connection's locks."""
    opener = connect_fn if connect_fn is not None else sqlite3.connect
    kwargs["factory"] = _tracking_factory(kwargs.get("factory", sqlite3.Connection))

    with _live_lock:
        conn = opener(str(path), **kwargs)
        try:
            resolved = _key(tracking_path) if tracking_path is not None else _canonical_db_path(conn)
            if resolved is None:
                return conn  # in-memory / unnamed: nothing on disk to byte-probe
            if not isinstance(conn, _TrackingMixin):
                # The opener substituted its own factory and discarded ours (test doubles
                # simulating FTS5-less runtimes do this). Retag the instance's class so close()
                # still releases the registry entry rather than silently losing probe safety.
                conn = _retrofit_tracking(conn, resolved)
            _track_key(resolved)
            release = _ReleaseOnClose(resolved)
            try:
                # Confirm registration without running SQL (a statement would read the schema and
                # wait on locks): sqlite3 holds a reference to the callable while it is registered.
                before = sys.getrefcount(release)
                conn.create_function(_RELEASE_FUNCTION, 0, release)
                if sys.getrefcount(release) == before:  # dropped: nothing would release the entry
                    raise sqlite3.ProgrammingError("connection factory did not register the release function")
            except Exception:
                _track_key(resolved, -1)  # the release object can never fire: take the count back
                raise
            release.armed = True
            conn._hermes_tracked_path = resolved
            return conn
        except Exception:
            try:
                # Close via sqlite3 directly: the tracking entry was either never made or is
                # being unwound here.
                sqlite3.Connection.close(conn)
            except Exception:
                pass
            raise


def _retrofit_tracking(conn: sqlite3.Connection, resolved: str) -> sqlite3.Connection:
    """Give an already-open connection untrack-on-close semantics by swapping ``__class__`` for
    one mixing in the tracking ``close()`` (used when an opener ignored the factory we asked for)."""
    cls = type(conn)
    try:
        conn.__class__ = _tracking_factory(cls)  # type: ignore[assignment]
        return conn
    except TypeError as exc:
        raise UntrackableConnectionError(
            f"connection to {resolved} uses factory {cls.__name__}, which "
            "cannot release its tracking entry on close; byte-probe safety "
            "for this database would be silently lost"
        ) from exc


def page_count_bytes(conn: sqlite3.Connection) -> Optional[int]:
    """Logical database size in bytes (``page_count * page_size``, the header field at offset 28)
    read via PRAGMA over *conn* so no new fd is opened. ``None`` when the pragmas cannot be read."""
    try:
        page_count = conn.execute("PRAGMA page_count").fetchone()[0]
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        return int(page_count) * int(page_size)
    except (sqlite3.Error, TypeError, IndexError, ValueError) as exc:
        logger.debug("page_count/page_size unavailable: %s", exc)
        return None


def file_length_matches_header(conn: sqlite3.Connection) -> Optional[bool]:
    """Whether the file on disk is at least as long as the header claims ("torn extend" check),
    without opening the file (PRAGMA over *conn* + ``stat()``). Advisory in WAL mode: a freshly
    committed page may still live in ``-wal`` so the main file legitimately lags."""
    path_str = _canonical_db_path(conn)
    if path_str is None:
        return None
    logical = page_count_bytes(conn)
    if not logical:
        return None
    try:
        return os.path.getsize(path_str) >= logical
    except OSError:
        return None


def read_header_bytes_preopen(path: Path | str, *, length: int = 100, force: bool = False) -> Optional[bytes]:
    """Read the first *length* bytes of *path* -- only when no connection is live. The ONLY
    sanctioned byte-level read of a database file, for first-open validation (real SQLite? zeroed?
    overwritten?). Check and open/read/close run together under ``_live_lock`` so a connection
    cannot be opened between deciding "nothing is live" and closing this descriptor."""
    with _live_lock:
        if not force and _live_main_key(_key(path)) is not None:
            logger.debug(
                "refusing byte-level read of %s: a live connection exists in "
                "this process and close() would cancel its POSIX locks",
                path)
            return None
        try:
            with open(path, "rb") as handle:
                return handle.read(length)
        except OSError:
            return None


@contextlib.contextmanager
def offline_file_access(path: Path | str, *, what: str = "read"):
    """Hold the connection-lifecycle lock across a raw read of a database file: checking
    :func:`has_live_connection` and *then* doing raw I/O is a check/use race (a connection opened
    in between loses its POSIX locks to the raw ``close()``). Held only for the raw I/O."""
    with _live_lock:
        main = _live_main_key(_key(path))
        if main is not None:
            subject = "it" if main == _key(path) else f"its main database {main}"
            raise LiveConnectionError(
                f"Refusing to {what} {path}: a connection to {subject} is still open "
                "in this process, and raw file access would cancel that "
                "connection's POSIX advisory locks. Close all database "
                "handles (stop the gateway/dashboard) and retry.")
        yield


def _is_operator_store_link(link: Path, link_st: os.stat_result) -> bool:
    """A ``state.db`` symlink this user owns, to an existing file this user owns.

    A dangling link is refused: SQLite would create the store wherever it points, such as an
    unmounted volume's mount point (symlinked home directories follow the same rule). A link or
    target owned by anyone else is refused as planted (#109857).
    """
    try:
        target_st = os.stat(link)
    except OSError:
        return False
    uid = os.geteuid() if hasattr(os, "geteuid") else None
    return uid is not None and link_st.st_uid == uid and target_st.st_uid == uid


def _chmod_pinned_inode(path: Path, mode: int) -> None:
    """Tighten ``path`` without following a link swapped in after the lstat().

    A bare chmod(2) on the path re-resolves the name, so a replacement symlink
    racing between validation and chmod could change the mode of an unrelated
    target (#109857). On Linux the validated inode is pinned with an O_PATH
    descriptor and reached through ``/proc/self/fd/<fd>``; an O_PATH descriptor
    holds no POSIX locks, so closing it stays lock-neutral for live SQLite
    connections. Platforms without O_PATH (macOS/BSD) use the no-follow chmod,
    which applies to the link itself, never to a swapped-in target.
    """
    if hasattr(os, "O_PATH"):
        # O_PATH|O_NOFOLLOW pins a swapped-in symlink itself instead of failing.
        fd = os.open(path, os.O_PATH | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            st_mode = os.fstat(fd).st_mode
            if stat.S_ISLNK(st_mode):
                raise OSError(errno.ELOOP, os.strerror(errno.ELOOP), str(path))
            if not stat.S_ISREG(st_mode):
                return
            try:
                os.chmod(f"/proc/self/fd/{fd}", mode)
            except FileNotFoundError:
                # No /proc (minimal chroot/sandbox): leave the mode as is rather
                # than fall back to a pathname chmod that could follow a swap.
                logger.debug("state db: /proc unavailable; not tightening %s", path)
        finally:
            os.close(fd)
    else:
        os.chmod(path, mode, follow_symlinks=False)


def _secure_state_db_files(db_path: Path, *, create_main: bool = False) -> None:
    """Create/tighten a writable state database and its sidecars to 0600.

    SQLite otherwise creates ``state.db``, ``-wal``, and ``-shm`` according to
    the process umask (commonly 0644 under 0022). Read-only holders
    never call this helper and remain observational.

    Existing files are tightened without ever (re)opening them: opening the
    file and closing that descriptor would drop every POSIX ``fcntl`` lock the
    process holds on its inode — including the locks of an already-open SQLite
    connection to the same database. A lock-losing close in one process lets a
    sibling's connection take the shared-memory DMS exclusively at its own
    close, checkpoint, and unlink the sidecars while long-lived holders
    (gateway, desktop ``hermes serve``) keep using the deleted inodes.
    Symlinked state paths fail closed with ``ELOOP`` before the caller's
    ``sqlite3.connect()`` can follow them (#109857), except a ``state.db``
    link the operator made to a store of their own (#145075).
    """
    if os.name == "nt":
        return

    main_path = db_path
    if create_main:
        # O_EXCL: only a brand-new inode gets a descriptor. Opening an existing
        # file here and closing it would drop this process's POSIX locks on it.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        try:
            fd = os.open(main_path, flags, 0o600)
        except FileExistsError:
            pass
        except IsADirectoryError:
            # Not a database file at all; sqlite3.connect() raises the
            # canonical error for this, and a directory leaks no row data.
            return
        else:
            os.close(fd)

    for path in (
        main_path,
        db_path.with_name(db_path.name + "-wal"),
        db_path.with_name(db_path.name + "-shm"),
    ):
        # fchmod on an ordinary fd of a pre-existing file cannot be used here:
        # close(fd) would release this process's POSIX locks on that inode,
        # stripping the locks of any live SQLite connection to the same database.
        # _chmod_pinned_inode never takes a lock-bearing descriptor.
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(st.st_mode):
            if path == main_path and _is_operator_store_link(path, st):
                # A store moved to other storage and linked back (#145075): SQLite follows the link as
                # before, and the target keeps the mode its owner gave it.
                continue
            # Fail closed exactly like the O_NOFOLLOW create above: silently
            # skipping the link lets the caller's sqlite3.connect() follow it
            # and operate on whatever it points at (#109857).
            raise OSError(errno.ELOOP, os.strerror(errno.ELOOP), str(path))
        if not stat.S_ISREG(st.st_mode):
            continue
        try:
            _chmod_pinned_inode(path, 0o600)
        except FileNotFoundError:
            continue  # SQLite retired an idle sidecar after lstat.


@contextlib.contextmanager
def quarantine_cross_process_lock(path: Path, timeout: float = 5.0):
    """Acquire the cross-process lock for path.quarantine.lock."""
    import platform
    lock_path = path.with_name(path.name + ".quarantine.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    acquired = False
    try:
        if platform.system() == "Windows":
            import msvcrt
            def _lock(mode):  # msvcrt locks a byte range from the current position
                handle.seek(0)
                msvcrt.locking(handle.fileno(), mode, 1)

            _try_lock = lambda: _lock(msvcrt.LK_NBLCK)
            _unlock = lambda: _lock(msvcrt.LK_UNLCK)
        else:
            import fcntl
            _try_lock = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            _unlock = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        deadline = time.monotonic() + timeout
        while not acquired:
            try:
                _try_lock()
                acquired = True
            except OSError:
                if time.monotonic() >= deadline:
                    break
                time.sleep(0.020)
        yield acquired
    finally:
        try:
            if acquired:
                _unlock()
        except (OSError, AttributeError):
            pass
        finally:
            handle.close()
