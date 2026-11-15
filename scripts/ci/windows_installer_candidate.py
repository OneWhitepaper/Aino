"""Build test-signed MSIX/AppInstaller pairs on a private disposable Actions runner.

These artifacts are acceptance inputs, never release or channel publication inputs.
The private key stays nonexportable in CurrentUser. Only its public certificate is
trusted in LocalMachine TrustedPeople; both are removed after acceptance.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TAGS = ("v0.1.6", "v0.1.7")
MINIMUM_WINDOWS = "10.0.19045.0"


def admit(env: Mapping[str, str], event: dict) -> str:
    """Reject public, self-hosted, nonmanual and unpinned execution before mutation."""
    repository = event.get("repository", {})
    manual = env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
    candidate_push = (env.get("GITHUB_EVENT_NAME") == "push"
                      and env.get("GITHUB_REF", "").startswith("refs/heads/validation/windows-installer/"))
    if (env.get("GITHUB_ACTIONS") != "true" or not (manual or candidate_push)
            or env.get("RUNNER_ENVIRONMENT") != "github-hosted" or env.get("RUNNER_OS") != "Windows"
            or repository.get("private") is not True
            or repository.get("full_name") != env.get("GITHUB_REPOSITORY")):
        raise ValueError("Private repository manual dispatch on a disposable hosted Windows runner required")
    commit = env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Exact workflow source commit required")
    return commit


def run(argv: list[str], env: Mapping[str, str], *, log: Path | None = None) -> str:
    print("candidate: " + subprocess.list2cmdline(argv), flush=True)
    # pwsh -> Python -> powershell.exe bypasses PowerShell 7's WinPS path cleanup.
    # Each child must rebuild its own module path, including nested build/E2E scripts.
    child_env = {key: value for key, value in env.items() if key.upper() != "PSMODULEPATH"}
    if log is None:
        return subprocess.check_output(argv, cwd=ROOT, env=child_env, text=True, encoding="utf-8", timeout=300).strip()
    with log.open("w", encoding="utf-8") as output:
        try:
            subprocess.run(argv, cwd=ROOT, env=child_env, stdout=output, stderr=subprocess.STDOUT,
                           check=True, timeout=18000)
        finally:
            output.flush()
            print(log.read_text(encoding="utf-8-sig", errors="replace"), flush=True)
    return ""


def powershell(script: str, env: Mapping[str, str]) -> str:
    return run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; " + script], env)


def check_prerequisites(env: Mapping[str, str], out: Path) -> None:
    repository = json.loads(run(["gh", "repo", "view", env["GITHUB_REPOSITORY"],
                                 "--json", "isPrivate,nameWithOwner"], env))
    if repository.get("isPrivate") is not True or repository.get("nameWithOwner") != env["GITHUB_REPOSITORY"]:
        raise ValueError("GitHub API did not confirm the candidate repository is private")
    powershell(r"""
    Get-Command Add-AppxPackage -ErrorAction Stop | Out-Null
    $installer = @(Get-AppxPackage -Name Microsoft.DesktopAppInstaller)
    $os = Get-CimInstance Win32_OperatingSystem
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    @{ os=$os.Caption; version=$os.Version; productType=$os.ProductType
       administrator=$administrator; appInstaller=@($installer | Select-Object Name, Version, PackageFullName) } |
       ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $env:CANDIDATE_PREREQUISITES
    if ($installer.Count -ne 1) { throw 'Microsoft.DesktopAppInstaller must be installed for this runner user' }
    if (-not $administrator) { throw 'Disposable runner must already be elevated for package-signing test trust' }
    """, {**env, "CANDIDATE_PREREQUISITES": str(out / "runner-prerequisites.json")})


def create_certificate(env: Mapping[str, str]) -> str:
    powershell(r"""
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $env:CANDIDATE_PUBLISHER `
      -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 `
      -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddDays(2)
    $cert.Thumbprint | Set-Content -Encoding UTF8 -LiteralPath $env:CANDIDATE_THUMBPRINT
    Export-Certificate -Cert $cert -FilePath $env:CANDIDATE_CERTIFICATE | Out-Null
    Import-Certificate -FilePath $env:CANDIDATE_CERTIFICATE -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
    """, env)
    thumbprint = Path(env["CANDIDATE_THUMBPRINT"]).read_text(encoding="utf-8-sig").strip()
    if not re.fullmatch(r"[A-F0-9]{40}", thumbprint):
        raise ValueError("Candidate certificate thumbprint is invalid")
    return thumbprint


def remove_certificate(env: Mapping[str, str]) -> str:
    if not Path(env["CANDIDATE_THUMBPRINT"]).is_file():
        state = Path(env["CANDIDATE_THUMBPRINT"]).parent / "certificate-state.json"
        state.write_text(json.dumps({"publisher": env["CANDIDATE_PUBLISHER"], "cleanup": "not-created",
                                     "privateKeyExported": False}) + "\n", encoding="utf-8")
        return "not-created"
    powershell(r"""
    $thumbprint = (Get-Content -Raw -LiteralPath $env:CANDIDATE_THUMBPRINT).Trim()
    if ($thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Invalid candidate certificate thumbprint' }
    foreach ($store in @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\TrustedPeople')) {
      $path = "$store\$thumbprint"
      if (Test-Path -LiteralPath $path) {
        if ((Get-Item -LiteralPath $path).Subject -cne $env:CANDIDATE_PUBLISHER) { throw 'Foreign certificate' }
        if ($store -eq 'Cert:\CurrentUser\My') { Remove-Item -LiteralPath $path -DeleteKey }
        else { Remove-Item -LiteralPath $path }
        if (Test-Path -LiteralPath $path) { throw "Candidate certificate remains in $store" }
      }
    }
    """, env)
    state = Path(env["CANDIDATE_THUMBPRINT"]).parent / "certificate-state.json"
    state.write_text(json.dumps({"publisher": env["CANDIDATE_PUBLISHER"], "cleanup": "removed",
                                 "privateKeyExported": False, "privateKeyDeletionRequested": True}) + "\n",
                     encoding="utf-8")
    return "removed"


def local_claim(tag: str, commit: str, epoch: int, env: Mapping[str, str]) -> tuple[str, str]:
    """Only local annotated refs satisfy the existing immutable timestamp contract."""
    claim = f"rc.1-{tag}"
    stamp = datetime.fromtimestamp(epoch, UTC).isoformat()
    identity = {**env, "GIT_COMMITTER_NAME": "Aino installer acceptance",
                "GIT_COMMITTER_EMAIL": "installer-acceptance@localhost", "GIT_COMMITTER_DATE": stamp}
    run(["git", "tag", "-a", claim, commit, "-m", "Private test-signing acceptance only; never publish"], identity)
    return claim, run(["git", "rev-parse", f"refs/tags/{claim}"], env)


def verify_package_contract(package: Path, publisher: str, arch: str) -> dict:
    """The actual SDK-validated package must retain native integration at the Win10 floor."""
    with zipfile.ZipFile(package) as archive:
        manifest = ET.fromstring(archive.read("AppxManifest.xml"))
    family = manifest.find("{*}Dependencies/{*}TargetDeviceFamily")
    identity = manifest.find("{*}Identity")
    if (family is None or family.get("MinVersion") != MINIMUM_WINDOWS or identity is None
            or identity.get("Publisher") != publisher or identity.get("ProcessorArchitecture") != arch):
        raise ValueError("Candidate MSIX minimum OS, architecture or test publisher mismatch")
    extensions = manifest.findall(".//{*}Extension")
    categories = {entry.get("Category") for entry in extensions}
    if not {"windows.protocol", "windows.appExecutionAlias", "windows.appExtension"} <= categories:
        raise ValueError("Candidate package lost its protocol, CLI aliases or native app extension")
    if not any(node.get("Name") == "com.microsoft.windows.copilotkeyprovider"
               for node in manifest.findall(".//{*}AppExtension")):
        raise ValueError("Candidate package lost its Copilot key provider")
    return {"minimumWindows": family.get("MinVersion"), "extensionCategories": sorted(categories)}


def bundle_candidate(slot: str, tag: str, arch: str, env: dict[str, str], out: Path,
                     thumbprint: str) -> dict:
    from scripts.bundles.release_artifacts import record, sha256_file, single, write_appinstaller

    prepared = json.loads((out / slot / "prepared.json").read_text(encoding="utf-8-sig"))
    node, packaging = prepared["node"], prepared["packager"]
    tools_script = (
        "import { ensureWindowsBundleTools } from './apps/desktop/scripts/windows-bundle-tools.mjs';"
        "console.log(JSON.stringify(await ensureWindowsBundleTools({prepared:process.argv[1]})))"
    )
    tools = json.loads(run([node, "--input-type=module", "-e", tools_script, packaging], env))
    release = ROOT / "apps/desktop/release"
    package = single(release.glob(f"*-{tag[1:]}-win-{arch}.msix"))
    contract = verify_package_contract(package, env["AZURE_SIGN_PUBLISHER"], arch)
    signature = [tools["signtool"], "sign", "/fd", "SHA256", "/s", "My", "/sha1", thumbprint]
    run([*signature, str(package)], env, log=out / f"{slot}-package-sign.log")
    metadata = out / f"{slot}-metadata.json"
    record("windows", arch, release, tag, env["GITHUB_SHA"], metadata)
    row = json.loads(metadata.read_text(encoding="utf-8-sig"))
    staging = out / f"{slot}-bundle-staging"
    staging.mkdir()
    shutil.copy2(package, staging / package.name)
    bundle = out / f"{slot}.msixbundle"
    run([tools["makeappx"], "bundle", "/o", "/bv", row["version"], "/d", str(staging), "/p", str(bundle)],
        env, log=out / f"{slot}-bundle.log")
    run([*signature, str(bundle)], env, log=out / f"{slot}-bundle-sign.log")
    run([tools["signtool"], "verify", "/pa", "/v", str(bundle)], env, log=out / f"{slot}-bundle-verify.log")
    shutil.rmtree(staging)
    write_appinstaller(out / f"{slot}.appinstaller", identity=row["identity"], publisher=row["publisher"],
                       version=row["version"], self_uri=f"http://127.0.0.1/{slot}.appinstaller",
                       artifact_uri=f"http://127.0.0.1/{slot}.msixbundle")
    return {**row, "sdk": contract, "artifact": {"path": str(bundle), "sha256": sha256_file(bundle),
                                               "url": f"http://127.0.0.1/{slot}.msixbundle"}}


def execute(arch: str, execute_e2e: bool) -> None:
    from pm.store import current_target
    from scripts.bundles.desktop_prepare import require_source

    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig"))
    commit = admit(os.environ, event)
    if current_target() != f"win32-{arch}":
        raise ValueError("Native Windows runner architecture must match the candidate")
    require_source(ROOT, commit)
    out = Path(os.environ["RUNNER_TEMP"]).resolve() / "aino-windows-installer"
    out.mkdir(exist_ok=False)
    publisher = f"CN=Aino Installer Candidate {uuid.uuid4()}"
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("AZURE_", "CSC_", "WIN_CSC_"))}
    env.update(AZURE_SIGN_PUBLISHER=publisher, CANDIDATE_PUBLISHER=publisher,
               CANDIDATE_THUMBPRINT=str(out / "certificate-thumbprint.txt"),
               CANDIDATE_CERTIFICATE=str(out / "candidate-public.cer"))
    (out / "certificate-state.json").write_text(
        json.dumps({"publisher": publisher, "cleanup": "pending", "privateKeyExported": False}) + "\n",
        encoding="utf-8")
    claims = []
    receipt = {"schema": 1, "candidateOnly": True, "testSigning": True, "sourceCommit": commit,
               "arch": arch, "minimumWindows": MINIMUM_WINDOWS, "status": "building"}
    try:
        check_prerequisites(env, out)
        env["AINO_PRIVATE_CANDIDATE"] = "true"
        thumbprint = create_certificate(env)
        sides = {}
        epoch = int(time.time()) - 120
        for index, (slot, tag) in enumerate(zip(("old", "new"), TAGS, strict=True)):
            claim, claim_object = local_claim(tag, commit, epoch + index * 60, env)
            claims.append((claim, claim_object))
            build_env = {**env, "RELEASE_CLAIM_TAG": claim, "RELEASE_CLAIM_OBJECT": claim_object}
            run([sys.executable, str(ROOT / "scripts/bundles/desktop.py"), "--tag", tag,
                 "--release-commit", commit, "--variant", "bundled", "--clean",
                 "--work", str(out / slot), "--cache", str(ROOT / ".cache/desktop-inputs"),
                 "--", f"-c.msix.minVersion={MINIMUM_WINDOWS}", "--publish", "never"],
                build_env, log=out / f"{slot}-build.log")
            sides[slot] = bundle_candidate(slot, tag, arch, build_env, out, thumbprint)
        manifest = out / "candidate-inputs.json"
        manifest.write_text(json.dumps({"schema": 1, "platform": "windows", "arch": arch,
                                        "candidateOnly": True, "testSigning": True, **sides}, indent=2) + "\n",
                            encoding="utf-8")
        receipt["status"] = "packaged"
        if execute_e2e:
            # Bundle preparation owns node_modules and replaces earlier workspace
            # selections. Install the existing acceptance driver after the final build.
            run(["just", "js-install-tests"], env, log=out / "chat-driver-dependencies.log")
            run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                 str(ROOT / "tests/install/windows-bundled-e2e.ps1"), "-CandidateManifest", str(manifest),
                 "-Arch", arch], env, log=out / "native-acceptance.log")
            receipt["status"] = "accepted"
    except Exception as error:
        receipt["status"] = "failed"
        receipt["error"] = str(error)
        raise
    finally:
        try:
            receipt["certificateCleanup"] = remove_certificate(env)
        except Exception as error:
            receipt.update(status="failed", certificateCleanup="failed", cleanupError=str(error))
            raise
        finally:
            (out / "candidate-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
            for claim, claim_object in claims:
                run(["git", "update-ref", "-d", f"refs/tags/{claim}", claim_object], env)


def cleanup() -> None:
    """Actions always-step backstop when cancellation interrupts the main finally."""
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig"))
    admit(os.environ, event)
    out = Path(os.environ["RUNNER_TEMP"]).resolve() / "aino-windows-installer"
    state = out / "certificate-state.json"
    if state.is_file():
        publisher = json.loads(state.read_text(encoding="utf-8-sig"))["publisher"]
        if not re.fullmatch(r"CN=Aino Installer Candidate [a-f0-9-]{36}", publisher):
            raise ValueError("Foreign candidate certificate state")
        result = remove_certificate({**os.environ, "CANDIDATE_PUBLISHER": publisher,
                                     "CANDIDATE_THUMBPRINT": str(out / "certificate-thumbprint.txt")})
        (out / "cleanup-receipt.json").write_text(
            json.dumps({"candidateOnly": True, "testSigning": True, "certificateCleanup": result}) + "\n",
            encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arch", choices=("x64", "arm64"), default="x64")
    parser.add_argument("--execute-e2e", action="store_true", help="Run native acceptance before deleting test trust")
    parser.add_argument("--cleanup", action="store_true", help="Remove only this job's disposable certificate")
    args = parser.parse_args()
    if args.cleanup:
        cleanup()
    else:
        execute(args.arch, args.execute_e2e)


if __name__ == "__main__":
    main()
