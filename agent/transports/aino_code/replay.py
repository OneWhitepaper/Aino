"""Keep native reasoning/signatures in Codex's opaque replay field across restarts.

This is protocol state, not a second conversation store. The existing Codex
transcript owns the ciphertext; the captured profile owns its private key.
"""

import json
import os
import stat
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

_REPLAY_LIMIT = 32 * 1024 * 1024

def load_replay_key(home: Path) -> bytes:
    path = home / "protocol-replay.key"
    if not path.exists() and not path.is_symlink():
        fd, temporary = tempfile.mkstemp(prefix=".protocol-replay-", dir=home)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(Fernet.generate_key())
                handle.flush()
                os.fsync(handle.fileno())
            try:
                # Publish a complete key exactly once; parallel sessions never replace it.
                os.link(temporary, path)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
    if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("The Code protocol replay key must be a private regular file.")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as handle:
        key = handle.read(128)
    Fernet(key)  # Never replace an invalid key and silently lose signed history.
    return key


class ReplayCodec:
    def __init__(self, key: bytes, scope: str):
        self.cipher = Fernet(key)
        self.scope = scope

    def seal(self, payload: dict) -> str:
        encoded = json.dumps({"scope": self.scope, "data": payload}, ensure_ascii=False).encode()
        token = "aino_bridge_v1:" + self.cipher.encrypt(encoded).decode("ascii")
        if len(token) > _REPLAY_LIMIT:
            raise ValueError("Code protocol replay state is too large.")
        return token

    def open(self, token: str) -> dict:
        if not isinstance(token, str) or not token.startswith("aino_bridge_v1:"):
            return {}
        if len(token) > _REPLAY_LIMIT:
            raise ValueError("Code protocol replay state is too large.")
        try:
            payload = json.loads(self.cipher.decrypt(token.partition(":")[2].encode("ascii")))
        except (InvalidToken, UnicodeError, ValueError) as exc:
            raise ValueError("Code protocol replay state could not be verified.") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
            raise ValueError("Code protocol replay state is invalid.")
        return payload["data"] if payload.get("scope") == self.scope else {}
