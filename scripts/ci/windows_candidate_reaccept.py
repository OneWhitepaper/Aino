"""Reaccept exact private test-signed candidates without rebuilding or resigning."""
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ci.windows_installer_candidate import ROOT, admit, powershell, run

REQUIRED = {"old.msixbundle", "new.msixbundle", "candidate-inputs.json",
            "candidate-public.cer", "candidate-receipt.json"}


def extract_inputs(archive: Path, destination: Path) -> None:
    """Read only fixed candidate inputs; diagnostics are never executed or extracted."""
    with zipfile.ZipFile(archive) as package:
        selected = {}
        for info in package.infolist():
            name = info.filename.replace("\\", "/")
            if name.rsplit("/", 1)[-1] not in REQUIRED:
                continue
            basename = name.rsplit("/", 1)[-1]
            if name not in (basename, f"aino-windows-installer/{basename}") or basename in selected:
                raise ValueError("Ambiguous or unsafe candidate artifact layout")
            if info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Candidate inputs must be regular files")
            cap = 12 * 1024**3 if basename.endswith(".msixbundle") else 1024**2
            if info.file_size <= 0 or info.file_size > cap:
                raise ValueError("Candidate input size is invalid")
            selected[basename] = info
        if selected.keys() != REQUIRED:
            raise ValueError("Candidate artifact is missing required inputs")
        for basename, info in selected.items():
            with package.open(info) as source, (destination / basename).open("xb") as target:
                shutil.copyfileobj(source, target, 1024 * 1024)


def download_archive(repository: str, artifact_id: int, digest: str, size: int,
                     destination: Path, env: dict[str, str]) -> None:
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest) or not 0 < size < 24 * 1024**3:
        raise ValueError("GitHub artifact digest and bounded size required")
    if shutil.disk_usage(destination.parent).free < size * 2 + 2 * 1024**3:
        raise ValueError("Insufficient disposable disk for verified candidate download and extraction")
    # gh owns authenticated API redirects; no bearer token is copied to blob URLs.
    child_env = {key: value for key, value in env.items() if key.upper() != "PSMODULEPATH"}
    with destination.open("xb") as output:
        subprocess.run(["gh", "api", f"repos/{repository}/actions/artifacts/{artifact_id}/zip"],
                       cwd=ROOT, env=child_env, stdout=output, check=True, timeout=1800)
    with destination.open("rb") as downloaded:
        actual = hashlib.file_digest(downloaded, "sha256").hexdigest()
    if actual != digest.removeprefix("sha256:") or destination.stat().st_size != size:
        raise ValueError("Downloaded candidate artifact digest or size mismatch")


def trust_candidate(directory: Path, env: dict[str, str]) -> str:
    powershell(r"""
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevated disposable runner required' }
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($env:REUSE_CERTIFICATE)
    if ($cert.HasPrivateKey -or $cert.Subject -cnotmatch '^CN=Aino Installer Candidate [a-f0-9-]{36}$' -or
        $cert.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $cert.NotAfter.ToUniversalTime() -le [DateTime]::UtcNow) {
      throw 'Valid public-only candidate signing certificate required'
    }
    $path = "Cert:\LocalMachine\TrustedPeople\$($cert.Thumbprint)"
    if (Test-Path -LiteralPath $path) { throw 'Refusing to own preexisting package trust' }
    foreach ($file in @('old.msixbundle', 'new.msixbundle')) {
      $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $env:REUSE_INPUTS $file)
      if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -cne $cert.Thumbprint) {
        throw 'Package signer does not match the exact reused certificate'
      }
    }
    @{ thumbprint=$cert.Thumbprint; subject=$cert.Subject; owned=$true } | ConvertTo-Json |
      Set-Content -Encoding UTF8 -LiteralPath $env:REUSE_TRUST_STATE
    Import-Certificate -FilePath $env:REUSE_CERTIFICATE -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    foreach ($file in @('old.msixbundle', 'new.msixbundle')) {
      $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $env:REUSE_INPUTS $file)
      if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -cne $cert.Thumbprint) {
        throw 'Reused package signature verification failed'
      }
    }
    """, {**env, "REUSE_CERTIFICATE": str(directory / "candidate-public.cer"),
          "REUSE_INPUTS": str(directory), "REUSE_TRUST_STATE": str(directory.parent / "trust-state.json")})
    return json.loads((directory.parent / "trust-state.json").read_text(encoding="utf-8-sig"))["subject"]


def cleanup_trust(out: Path, env: dict[str, str]) -> None:
    state = out / "trust-state.json"
    if not state.is_file():
        return
    powershell(r"""
    $state = Get-Content -Raw -LiteralPath $env:REUSE_TRUST_STATE | ConvertFrom-Json
    if ($state.owned -ne $true -or $state.thumbprint -cnotmatch '^[A-F0-9]{40}$' -or
        $state.subject -cnotmatch '^CN=Aino Installer Candidate [a-f0-9-]{36}$') { throw 'Invalid reuse trust ownership' }
    $path = "Cert:\LocalMachine\TrustedPeople\$($state.thumbprint)"
    if (Test-Path -LiteralPath $path) {
      if ((Get-Item -LiteralPath $path).Subject -cne $state.subject) { throw 'Foreign package trust' }
      Remove-Item -LiteralPath $path
    }
    if (Test-Path -LiteralPath $path) { throw 'Reused certificate trust remains' }
    """, {**env, "REUSE_TRUST_STATE": str(state)})
    (out / "cleanup-receipt.json").write_text('{"packageTrustRemoved":true}\n', encoding="utf-8")


def execute(env: dict[str, str], out: Path) -> None:
    from pm.store import current_target
    from scripts.ci.windows_candidate_reuse import relocate_manifest, validate_origin

    repository = env["GITHUB_REPOSITORY"]
    run_id, artifact_id = int(env["REUSE_RUN_ID"]), int(env["REUSE_ARTIFACT_ID"])
    source, arch = env["REUSE_SOURCE_COMMIT"], env["REUSE_ARCH"]
    if current_target() != f"win32-{arch}":
        raise ValueError("Candidate reuse requires its native architecture")
    confirmed = json.loads(run(["gh", "repo", "view", repository, "--json", "isPrivate,nameWithOwner"], env))
    if confirmed != {"isPrivate": True, "nameWithOwner": repository}:
        raise ValueError("Exact private repository required")
    metadata = json.loads(run(["gh", "api", f"repos/{repository}/actions/artifacts/{artifact_id}"], env))
    origin = json.loads(run(["gh", "api", f"repos/{repository}/actions/runs/{run_id}"], env))
    bound = validate_origin(metadata, origin, source, arch, run_id, artifact_id)
    out.mkdir(exist_ok=False)
    receipt = {"candidateOnly": True, "testSigning": True, "harnessCommit": env["GITHUB_SHA"],
               "testedSourceCommit": source, "arch": arch, "artifactOrigin": bound, "status": "preparing",
               "startedAt": datetime.now(UTC).isoformat()}
    try:
        archive, inputs = out / "artifact.zip", out / "inputs"
        download_archive(repository, artifact_id, metadata["digest"], metadata["size_in_bytes"], archive, env)
        inputs.mkdir()
        extract_inputs(archive, inputs)
        archive.unlink()
        manifest = relocate_manifest(inputs, source, arch)
        publisher = trust_candidate(inputs, env)
        run(["just", "js-install-tests"], env, log=out / "driver-dependencies.log")
        run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
             str(ROOT / "tests/install/windows-bundled-e2e.ps1"), "-CandidateManifest", str(manifest),
             "-CandidateSourceCommit", source, "-Arch", arch],
            {**env, "AINO_PRIVATE_CANDIDATE": "true", "AINO_PRIVATE_REUSE_SOURCE_COMMIT": source,
             "AZURE_SIGN_PUBLISHER": publisher},
            log=out / "native-acceptance.log")
        receipt["status"] = "accepted"
    except Exception as error:
        receipt.update(status="failed", error=str(error))
        raise
    finally:
        try:
            cleanup_trust(out, env)
            receipt["certificateCleanup"] = "removed-or-not-created"
        except Exception as error:
            receipt.update(status="failed", certificateCleanup="failed", cleanupError=str(error))
            raise
        finally:
            (out / "reaccept-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    env = dict(os.environ)
    admit(env, json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig")))
    out = Path(env["RUNNER_TEMP"]).resolve() / "aino-windows-reaccept"
    if args.cleanup:
        cleanup_trust(out, env)
    else:
        execute(env, out)


if __name__ == "__main__":
    main()
