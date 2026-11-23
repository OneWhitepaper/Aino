"""Contained, bounded reads and atomic file publication without replacement."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import stat
import tempfile


@dataclass
class Budget:
    entries: int = 0
    files: int = 0
    bytes: int = 0

    def visit(self):
        self.entries += 1
        if self.entries > 100_000:
            raise ValueError("Code recovery scan entry limit exceeded")

    def reserve(self, size):
        self.files += 1
        self.bytes += size
        if self.files > 10_000 or self.bytes > 512 * 1024 * 1024:
            raise ValueError("Code recovery file/byte budget exceeded")


def checked(root: Path, path: Path):
    """Do not resolve an untrusted descendant through a symlink or a '..'."""
    relative = path.relative_to(root)
    if ".." in relative.parts:
        raise ValueError("recovery path escapes its home")
    current = root
    parts = ((), *[(part,) for part in relative.parts])
    result = None
    for part in parts:
        current = current.joinpath(*part)
        try:
            result = current.lstat()
        except FileNotFoundError:
            return None
        if stat.S_ISLNK(result.st_mode):
            raise ValueError(f"symlinked recovery path: {current}")
        if current != path and not stat.S_ISDIR(result.st_mode):
            raise ValueError(f"non-directory recovery path: {current}")
    return result


def homes(source: Path, target: Path):
    for path in (source, target):
        if not isinstance(path, Path) or not path.is_absolute():
            raise ValueError("recovery homes must be absolute Paths")
        if ".." in path.parts:
            raise ValueError("invalid recovery home path")
        # Include ancestors: an account directory must not be redirected either.
        checked(Path(path.anchor), path)
    if source == target or source in target.parents or target in source.parents:
        raise ValueError("recovery homes overlap")
    return source, target


def directory(root: Path, path: Path):
    info = checked(root, path)
    if info is None:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = checked(root, path)
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError(f"non-directory recovery path: {path}")


def regular(root: Path, path: Path, limit: int, *, reject_hardlinks=False):
    info = checked(root, path)
    if info is None or not stat.S_ISREG(info.st_mode):
        raise ValueError(f"non-regular recovery file: {path}")
    if reject_hardlinks and info.st_nlink != 1:
        raise ValueError(f"hard-linked recovery file: {path}")
    if info.st_size > limit:
        raise ValueError(f"recovery file exceeds size limit: {path}")
    return info


@contextmanager
def reader(root: Path, path: Path, limit: int, *, reject_hardlinks=True):
    before = regular(root, path, limit, reject_hardlinks=reject_hardlinks)
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("recovery source changed while opening")
        if reject_hardlinks and opened.st_nlink != 1:
            raise ValueError("hard-linked recovery source")
        yield handle
        after = os.fstat(handle.fileno())
        if (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
            raise ValueError("recovery source changed while reading; retry")


@dataclass(frozen=True)
class CopyFile:
    source: Path
    destination: Path
    size: int
    mtime_ns: int
    content: bytes | None = None


def publish(source_home: Path, target_home: Path, plan: CopyFile):
    """A complete temporary inode is linked into place only if the name is free."""
    if checked(target_home, plan.destination) is not None:
        regular(target_home, plan.destination, 512 * 1024 * 1024)
        return False
    directory(target_home, plan.destination.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=".code-recovery-", dir=plan.destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as output:
            _write(source_home, plan, output)
            output.flush()
            os.fsync(output.fileno())
        os.utime(temporary, ns=(plan.mtime_ns, plan.mtime_ns))
        checked(target_home, plan.destination)
        try:
            os.link(temporary, plan.destination, follow_symlinks=False)
        except FileExistsError:
            regular(target_home, plan.destination, 512 * 1024 * 1024)
            return False
        return True
    finally:
        temporary.unlink(missing_ok=True)


def _write(source_home, plan, output):
    if plan.content is not None:
        output.write(plan.content)
        return
    total = 0
    with reader(source_home, plan.source, 64 * 1024 * 1024) as source:
        while blob := source.read(1024 * 1024):
            total += len(blob)
            if total > plan.size:
                raise ValueError("recovery file grew; retry")
            output.write(blob)
    if total != plan.size:
        raise ValueError("recovery file changed size; retry")
