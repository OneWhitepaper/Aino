"""Fetch one immutable GitHub candidate archive for the existing native smoke lane."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def validate_artifact(metadata: dict, *, artifact_id: str, run: str, commit: str,
                      target: str, digest: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("Exact commit and archive SHA256 are required")
    if target not in ("linux-x64", "linux-arm64", "win32-x64", "win32-arm64"):
        raise ValueError("Unsupported candidate target")
    label = target.replace("win32-", "windows-")
    workflow = metadata.get("workflow_run") or {}
    if (str(metadata.get("id")) != artifact_id or str(workflow.get("id")) != run
            or workflow.get("head_sha") != commit or metadata.get("expired")
            or metadata.get("digest") != f"sha256:{digest}"
            or metadata.get("name") != f"aino-unverified-{label}-{commit}"):
        raise ValueError("Candidate metadata does not match the requested run, commit, target and digest")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("artifact-id", "run", "commit", "target", "digest", "out"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[1-9][0-9]*", args.artifact_id) or not re.fullmatch(r"[1-9][0-9]*", args.run):
        parser.error("Artifact and run IDs must be positive decimal integers")
    root = Path(args.out).resolve()
    root.mkdir(parents=True, exist_ok=False)
    endpoint = f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/artifacts/{args.artifact_id}"
    metadata = json.loads(subprocess.check_output(["gh", "api", endpoint], text=True, encoding="utf-8", timeout=60))
    validate_artifact(metadata, artifact_id=args.artifact_id, run=args.run, commit=args.commit,
                      target=args.target, digest=args.digest)
    archive = root / "candidate.zip"
    with archive.open("wb") as stream:
        subprocess.run(["gh", "api", f"{endpoint}/zip"], stdout=stream, check=True, timeout=1200)
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != args.digest:
            raise ValueError("Downloaded candidate archive digest differs from the exact input")
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            if Path(member.filename).name != member.filename or member.is_dir():
                raise ValueError("Candidate archive must contain only root-level release files")
        package.extractall(root)
    archive.unlink()
    (root / "source-artifact.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
