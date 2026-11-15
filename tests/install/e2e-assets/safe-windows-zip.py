"""Admit and extract a pinned Windows release ZIP without executing its payload."""
import hashlib
import json
import ntpath
from pathlib import Path
import shutil
import stat
import struct
import sys
import zipfile

COMMIT = "22a472fcbca8775f56c0f89374027b8e4c68ab5b"
RESERVE = 256 * 1024 * 1024
MACHINES = {"x64": 0x8664, "arm64": 0xAA64}


def require_space(directory, required):
    available = shutil.disk_usage(directory).free
    if available < required:
        raise ValueError(f"Insufficient disk space: need {required} bytes, {available} bytes available at {directory}")
    return {"required": required, "available": available}


def safe_parts(name):
    parts = name.rstrip("/").split("/")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
    if (not name or name.startswith("/") or ntpath.splitdrive(name)[0] or "\\" in name
            or any(not p or p in {".", ".."} or p.rstrip(" .") != p or ":" in p
                   or any(ord(c) < 32 or c in '<>"|?*' for c in p)
                   or p.split(".")[0].upper() in reserved for p in parts)):
        raise ValueError(f"Unsafe ZIP path: {name!r}")
    return parts


def admit_entries(archive):
    nodes, explicit, entries = {}, set(), []
    for entry in archive.infolist():
        parts = safe_parts(entry.orig_filename)
        mode = entry.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in {0, stat.S_IFREG, stat.S_IFDIR} or entry.external_attr & 0x400:
            raise ValueError(f"Unsafe ZIP link or special entry: {entry.filename!r}")
        if entry.flag_bits & 1:
            raise ValueError(f"Unsafe ZIP encrypted entry: {entry.filename!r}")
        full = "/".join(parts)
        if full.casefold() in explicit:
            raise ValueError(f"ZIP duplicate or case collision: {full!r}")
        explicit.add(full.casefold())
        for index in range(1, len(parts) + 1):
            name = "/".join(parts[:index])
            directory = index < len(parts) or entry.is_dir()
            previous = nodes.setdefault(name.casefold(), (name, directory))
            if previous != (name, directory):
                raise ValueError(f"ZIP case or file/directory collision: {name!r}")
        entries.append((entry, parts))
    return entries


def load_json(filename):
    with filename.open(encoding="utf-8-sig") as source:
        return json.load(source)


def validate_stamp(stamp):
    expected = {"schemaVersion": 1, "commit": COMMIT, "tag": "v0.1.5", "baseVersion": "0.1.5",
                "displayVersion": "0.1.5", "payload": "bundled", "updateMechanism": "external",
                "distribution": "desktop-app"}
    if not isinstance(stamp, dict) or any(stamp.get(key) != value for key, value in expected.items()):
        raise ValueError("Released Windows ZIP provenance mismatch (v0.1.5/commit/bundled/external required)")


def runtime_path(root, relative, directory=False):
    if not isinstance(relative, str):
        raise ValueError("Invalid payload runtime path")
    parts = safe_parts(relative)
    target = root.joinpath(*parts)
    if not (target.is_dir() if directory else target.is_file()):
        raise ValueError(f"Missing payload runtime path: {relative}")
    return target


def validate_pe(filename, arch):
    with filename.open("rb") as source:
        header = source.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise ValueError(f"Invalid Windows executable: {filename}")
        source.seek(struct.unpack_from("<I", header, 60)[0])
        pe = source.read(6)
    if len(pe) != 6 or pe[:4] != b"PE\0\0" or struct.unpack_from("<H", pe, 4)[0] != MACHINES[arch]:
        raise ValueError(f"Windows executable architecture mismatch: {filename}")


def validate_payload(out, arch):
    # The payload carries another install-stamp.json. Only desktop resources paired with its EXE count.
    candidates = [stamp for stamp in out.rglob("install-stamp.json")
                  if stamp.parent.name == "resources" and (stamp.parent.parent / "Aino Agent.exe").is_file()]
    if len(candidates) != 1:
        raise ValueError(f"Expected one unique desktop resources stamp/executable pair, found {len(candidates)}")
    desktop_stamp = candidates[0]
    stamp = load_json(desktop_stamp)
    validate_stamp(stamp)
    payload = desktop_stamp.parent / "agent-payload"
    runtime = stamp.get("runtime")
    if not isinstance(runtime, dict) or not isinstance(runtime.get("commands"), dict) or "hermes" not in runtime["commands"]:
        raise ValueError("Missing payload runtime launch contract")
    repo = runtime_path(payload, runtime.get("repoDir"), directory=True)
    runtime_path(payload, runtime.get("toolsDir"), directory=True)
    runtime_path(payload, runtime.get("sitePackages"), directory=True)
    interpreter = runtime_path(payload, runtime.get("storePython"))
    shim = runtime_path(payload, runtime["commands"]["hermes"])
    payload_stamp = repo / "install-stamp.json"
    inner = load_json(payload_stamp)
    validate_stamp(inner)
    manifest = load_json(payload / "manifest.json")
    if manifest.get("target") != f"win32-{arch}":
        raise ValueError("Payload architecture mismatch")
    if inner.get("runtime") != runtime or manifest.get("runtime") != runtime:
        raise ValueError("Desktop/payload provenance runtime contract mismatch")
    exe = desktop_stamp.parent.parent / "Aino Agent.exe"
    for executable in (exe, interpreter, shim):
        validate_pe(executable, arch)
    return {"exe": str(exe), "payloadRoot": str(payload), "stamp": stamp,
            "desktopStamp": str(desktop_stamp), "payloadStamp": str(payload_stamp), "target": manifest["target"]}


def extract(archive, out, arch, expected_size):
    if arch not in MACHINES:
        raise ValueError("Windows ZIP architecture must be x64 or arm64")
    if not out.is_absolute() or out.exists():
        raise ValueError("ZIP extraction requires an absent absolute output directory")
    size = archive.stat().st_size
    if size != expected_size:
        raise ValueError(f"Released Windows ZIP size mismatch: expected {expected_size}, received {size}")
    created = False
    try:
        with zipfile.ZipFile(archive) as source:
            entries = admit_entries(source)
            expanded = sum(entry.file_size for entry, _ in entries)
            disk = require_space(out.parent, expanded + RESERVE)
            out.mkdir()
            created = True
            for entry, parts in entries:
                destination = out.joinpath(*parts)
                if entry.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(entry) as reader, destination.open("xb") as writer:
                        shutil.copyfileobj(reader, writer, length=1024 * 1024)
            return {**validate_payload(out, arch), "expandedSize": expanded, "entries": len(entries), "extractionSpace": disk}
    except Exception:
        if created:
            shutil.rmtree(out)
        raise


def unwrap(archive, out, name, outer_size, outer_sha256, size, sha256):
    partial = out.with_name(out.name + ".partial")
    if not out.is_absolute() or out.exists() or partial.exists():
        raise ValueError("GitHub wrapper requires an absent absolute inner ZIP path")
    if archive.stat().st_size != outer_size:
        raise ValueError("GitHub artifact size mismatch")
    with archive.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != outer_sha256:
            raise ValueError("GitHub artifact SHA-256 mismatch")
    try:
        with zipfile.ZipFile(archive) as package:
            entries = admit_entries(package)
            if len(entries) != 1 or entries[0][1] != [name] or entries[0][0].is_dir():
                raise ValueError("GitHub wrapper must contain only the exact release ZIP")
            entry = entries[0][0]
            if entry.file_size != size:
                raise ValueError("Inner release ZIP size mismatch")
            disk = require_space(out.parent, size + RESERVE)
            digest, received = hashlib.sha256(), 0
            with package.open(entry) as source, partial.open("xb") as target:
                while chunk := source.read(1024 * 1024):
                    received += len(chunk)
                    if received > size:
                        raise ValueError("Inner release ZIP size mismatch")
                    digest.update(chunk)
                    target.write(chunk)
            if received != size:
                raise ValueError("Inner release ZIP size mismatch")
            if digest.hexdigest() != sha256:
                raise ValueError("Inner release ZIP SHA-256 mismatch")
            partial.replace(out)
            return {"entry": name, "outer": {"size": outer_size, "sha256": outer_sha256},
                    "inner": {"size": size, "sha256": sha256}, "unwrappingSpace": disk}
    finally:
        partial.unlink(missing_ok=True)


def main():
    try:
        mode, *args = sys.argv[1:]
        if mode == "space":
            result = require_space(Path(args[0]), int(args[1]))
        elif mode == "extract":
            result = extract(Path(args[0]), Path(args[1]), args[2], int(args[3]))
        elif mode == "unwrap":
            result = unwrap(Path(args[0]), Path(args[1]), args[2], int(args[3]), args[4], int(args[5]), args[6])
        else:
            raise ValueError("Expected space, extract or unwrap")
        print(json.dumps(result))
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
