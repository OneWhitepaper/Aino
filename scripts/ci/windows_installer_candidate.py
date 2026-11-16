"""Build test-signed MSIX/AppInstaller pairs on a disposable Actions runner.

These artifacts are acceptance inputs, never release or channel publication inputs.
Public execution is an explicit receipts-only feature-branch capability.
The private key stays nonexportable in CurrentUser. Only its public certificate is
trusted in LocalMachine TrustedPeople; both are removed after acceptance.
"""
from __future__ import annotations

import argparse
import codecs
from collections.abc import Mapping
from datetime import UTC, datetime
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import BinaryIO
import uuid
import xml.etree.ElementTree as ET
import zipfile

import psutil

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TAGS = ("v0.1.6", "v0.1.7")
MINIMUM_WINDOWS = "10.0.19045.0"
PUBLIC_REPOSITORY = "OneWhitepaper/Aino"
PUBLIC_REF_PREFIX = "refs/heads/validation/windows-installer-public/"
CHILD_HEARTBEAT_SECONDS = 60.0
NATIVE_TOOL_TIMEOUT_SECONDS = 1800


def _public_opt_in(env: Mapping[str, str], event: dict) -> bool:
    inputs = event.get("inputs", {})
    explicit_dispatch = (env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
                         and (inputs.get("public-receipts-only") is True
                              or inputs.get("public-receipts-only") == "true"))
    return (env.get("GITHUB_REPOSITORY") == PUBLIC_REPOSITORY
            and env.get("GITHUB_REF", "").startswith(PUBLIC_REF_PREFIX)
            and (env.get("GITHUB_EVENT_NAME") == "push" or explicit_dispatch)
            and not any(inputs.get(key) for key in ("reuse-run-id", "reuse-artifact-id", "reuse-source-commit")))


def admit(env: Mapping[str, str], event: dict, *, public_receipts_only: bool = False) -> str:
    """Reject implicit public, self-hosted and unpinned execution before mutation."""
    repository = event.get("repository", {})
    manual = env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
    candidate_push = (env.get("GITHUB_EVENT_NAME") == "push"
                      and env.get("GITHUB_REF", "").startswith("refs/heads/validation/windows-installer/"))
    visibility_admitted = (repository.get("private") is False and _public_opt_in(env, event)
                           if public_receipts_only else repository.get("private") is True and (manual or candidate_push))
    if (env.get("GITHUB_ACTIONS") != "true" or not visibility_admitted
            or env.get("RUNNER_ENVIRONMENT") != "github-hosted" or env.get("RUNNER_OS") != "Windows"
            or repository.get("full_name") != env.get("GITHUB_REPOSITORY")):
        raise ValueError("Admitted private or explicit public receipts-only hosted Windows workflow required")
    commit = env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Exact workflow source commit required")
    return commit


def run(argv: list[str], env: Mapping[str, str], *, log: Path | None = None,
        timeout: float | None = None) -> str:
    print("candidate: " + subprocess.list2cmdline(argv), flush=True)
    # pwsh -> Python -> powershell.exe bypasses PowerShell 7's WinPS path cleanup.
    # Each child must rebuild its own module path, including nested build/E2E scripts.
    child_env = {key: value for key, value in env.items() if key.upper() != "PSMODULEPATH"}
    budget = timeout if timeout is not None else (18000 if log else 300)
    if log is None:
        from hermes_cli._subprocess_compat import bounded_probe_run

        result = bounded_probe_run(argv, cwd=ROOT, env=child_env, timeout=budget, raise_on_spawn_failure=True)
        if result is None:
            raise subprocess.TimeoutExpired(argv, budget)
        if result.stderr:
            print(result.stderr, file=sys.stderr, end="", flush=True)
        result.check_returncode()
        return result.stdout.strip()
    _run_logged(argv, child_env, log, budget)
    return ""


def _emit_log_tail(reader: BinaryIO, decoder: io.IncrementalNewlineDecoder, *, final: bool = False) -> None:
    # Bound each pass to the current file size so a noisy child cannot keep
    # extending this read and prevent the supervisor from checking its deadline.
    remaining = os.fstat(reader.fileno()).st_size - reader.tell()
    while remaining > 0:
        chunk = reader.read(min(remaining, 64 * 1024))
        if not chunk:
            break
        remaining -= len(chunk)
        text = decoder.decode(chunk)
        if text:
            print(text, end="", flush=True)
    if final:
        text = decoder.decode(b"", final=True)
        if text:
            print(text, end="", flush=True)


def _child_progress(process, owner, log: Path, started: float, status: str, *, emit: bool = True) -> None:
    value = {"operation": log.stem, "pid": process.pid, "status": status,
             "elapsedSeconds": round(time.monotonic() - started, 3), "outputBytes": log.stat().st_size,
             "returncode": process.poll(), "queryStatus": "gone"}
    try:
        if owner is not None and owner.is_running():
            with owner.oneshot():
                cpu = owner.cpu_times()
                value.update(queryStatus="ok", cpuSeconds=round(cpu.user + cpu.system, 3),
                             rssBytes=owner.memory_info().rss, childCount=len(owner.children()))
                if counters := getattr(owner, "io_counters", None):
                    io_stats = counters()
                    value.update(readBytes=io_stats.read_bytes, writeBytes=io_stats.write_bytes)
    except psutil.NoSuchProcess:
        value["queryStatus"] = "gone"
    except psutil.AccessDenied:
        value["queryStatus"] = "inaccessible"
    destination = log.with_suffix(".progress.json")
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value) + "\n", encoding="utf-8")
    temporary.replace(destination)
    if emit:
        print("[candidate-progress] " + json.dumps(value), flush=True)


def _wait_for_logged_child(process, argv, reader, decoder, log: Path, timeout: float) -> None:
    started = time.monotonic()
    deadline = started + timeout
    heartbeat = started + CHILD_HEARTBEAT_SECONDS
    try:
        owner = psutil.Process(process.pid)
    except psutil.NoSuchProcess:
        owner = None
    while process.poll() is None:
        now = time.monotonic()
        if now >= deadline:
            _child_progress(process, owner, log, started, "timed-out")
            raise subprocess.TimeoutExpired(argv, timeout)
        try:
            process.wait(timeout=min(2, deadline - now, max(0.01, heartbeat - now)))
        except subprocess.TimeoutExpired:
            _emit_log_tail(reader, decoder)
        if process.poll() is None and time.monotonic() >= heartbeat:
            _child_progress(process, owner, log, started, "running")
            heartbeat = time.monotonic() + CHILD_HEARTBEAT_SECONDS
    _child_progress(process, owner, log, started, "completed" if process.returncode == 0 else "failed", emit=False)
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, argv)


def _run_logged(argv: list[str], env: Mapping[str, str], log: Path, timeout: float) -> None:
    with log.open("wb") as output, log.open("rb") as reader:
        decoder = io.IncrementalNewlineDecoder(codecs.getincrementaldecoder("utf-8-sig")(errors="replace"), translate=True)
        with subprocess.Popen(argv, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT) as process:
            try:
                _wait_for_logged_child(process, argv, reader, decoder, log, timeout)
            except BaseException:
                from hermes_cli._subprocess_compat import kill_process_tree

                # Retained Popen ownership includes Windows launcher workers.
                kill_process_tree(process)
                process.wait(timeout=5)
                raise
            finally:
                output.flush()
                _emit_log_tail(reader, decoder, final=True)


def powershell(script: str, env: Mapping[str, str]) -> str:
    return run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                "$ErrorActionPreference='Stop'; " + script], env)


def check_prerequisites(env: Mapping[str, str], out: Path, *, public_receipts_only: bool = False) -> None:
    repository = json.loads(run(["gh", "repo", "view", env["GITHUB_REPOSITORY"],
                                 "--json", "isPrivate,nameWithOwner"], env))
    if (repository.get("isPrivate") is not (not public_receipts_only)
            or repository.get("nameWithOwner") != env["GITHUB_REPOSITORY"]
            or (public_receipts_only and env["GITHUB_REPOSITORY"] != PUBLIC_REPOSITORY)):
        raise ValueError("GitHub API did not confirm the admitted candidate repository visibility")
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
    run([*signature, str(package)], env, log=out / f"{slot}-package-sign.log", timeout=NATIVE_TOOL_TIMEOUT_SECONDS)
    metadata = out / f"{slot}-metadata.json"
    record("windows", arch, release, tag, env["GITHUB_SHA"], metadata)
    row = json.loads(metadata.read_text(encoding="utf-8-sig"))
    staging = out / f"{slot}-bundle-staging"
    staging.mkdir()
    shutil.copy2(package, staging / package.name)
    bundle = out / f"{slot}.msixbundle"
    run([tools["makeappx"], "bundle", "/o", "/bv", row["version"], "/d", str(staging), "/p", str(bundle)],
        env, log=out / f"{slot}-bundle.log", timeout=NATIVE_TOOL_TIMEOUT_SECONDS)
    run([*signature, str(bundle)], env, log=out / f"{slot}-bundle-sign.log", timeout=NATIVE_TOOL_TIMEOUT_SECONDS)
    run([tools["signtool"], "verify", "/pa", "/v", str(bundle)], env,
        log=out / f"{slot}-bundle-verify.log", timeout=NATIVE_TOOL_TIMEOUT_SECONDS)
    shutil.rmtree(staging)
    write_appinstaller(out / f"{slot}.appinstaller", identity=row["identity"], publisher=row["publisher"],
                       version=row["version"], self_uri=f"http://127.0.0.1/{slot}.appinstaller",
                       artifact_uri=f"http://127.0.0.1/{slot}.msixbundle")
    return {**row, "sdk": contract, "artifact": {"path": str(bundle), "sha256": sha256_file(bundle),
                                               "url": f"http://127.0.0.1/{slot}.msixbundle"}}


def execute(arch: str, execute_e2e: bool, *, public_receipts_only: bool = False) -> None:
    from pm.store import current_target
    from scripts.bundles.desktop_prepare import require_source

    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig"))
    commit = admit(os.environ, event, public_receipts_only=public_receipts_only)
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
        check_prerequisites(env, out, public_receipts_only=public_receipts_only)
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
                 "--", "--publish", "never"],
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


def cleanup(*, public_receipts_only: bool = False) -> None:
    """Actions always-step backstop when cancellation interrupts the main finally."""
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig"))
    admit(os.environ, event, public_receipts_only=public_receipts_only)
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
    parser.add_argument("--public-receipts-only", action="store_true", help="Explicit public feature-branch build; packages must never be uploaded")
    parser.add_argument("--collect-public-receipts", action="store_true", help="Project safe native results into the public upload file")
    args = parser.parse_args()
    if args.collect_public_receipts:
        if not args.public_receipts_only or args.cleanup or args.execute_e2e:
            parser.error("Public receipt collection requires only --public-receipts-only and --arch")
        from scripts.ci.windows_candidate_receipts import export_public_receipts

        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8-sig"))
        commit = admit(os.environ, event, public_receipts_only=True)
        export_public_receipts(Path(os.environ["RUNNER_TEMP"]).resolve(), commit, args.arch)
    elif args.cleanup:
        cleanup(public_receipts_only=args.public_receipts_only)
    else:
        execute(args.arch, args.execute_e2e, public_receipts_only=args.public_receipts_only)


if __name__ == "__main__":
    main()
