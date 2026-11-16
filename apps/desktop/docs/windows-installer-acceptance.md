# Windows installation and update acceptance

Status: update-checker correction implemented; native acceptance is in progress.
Distribution is held. This document does not authorize publishing installers or
production feeds.
The user requested test-signing acceptance first; production signing and ordinary
production trust are deferred until release preparation.

## Scope

- Windows 10 22H2 (19045) and Windows 11; x64 and ARM64 candidates.
- Existing MSIX/App Installer lifecycle, execution aliases and Copilot registration.
- First installation from the released ZIP retains the original Aino data root.
- Subsequent in-app updates retain encrypted authentication, original chat rows,
  Bot profiles, model configuration and user files.
- Preparation failure leaves OLD usable; OS cancellation permits manual OLD
  reopen without re-login; uninstall leaves external user data intact.

The `.appinstaller` entry point registers updates. Installing a bundle alone does
not establish that subscription. Existing ZIP users install the first MSIX
manually. The stable identity and `%APPDATA%\Aino` remain unchanged.

## Evidence as of 2026-11-16

| Check                                                          | Result                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Local updater, manifest and data-preservation contracts        | 63 passed                                                                        |
| Local candidate, fixture and runner Python contracts           | 51 passed; one Windows-only skip                                                 |
| Local release artifact and bundle naming contracts             | 13 passed                                                                        |
| Complete tests-js typecheck, tests and ESLint                  | Passed; 376 tests, five platform skips                                           |
| Complete desktop renderer, Electron, E2E and builder typecheck | Passed                                                                           |
| Repository `scripts/check`                                     | All 15 checks passed                                                             |
| Independent production and acceptance review                   | No P1/P2 findings                                                                |
| Native SDK pack/unpack at 19045 floor                          | Eight cases passed on Windows Server 2025                                        |
| Windows Python and acceptance-harness contracts                | 69 Python and 74 JS passed; nine platform skips                                  |
| Windows updater/state and descriptor contracts                 | 71 updater/state and four descriptor tests passed                                |
| Windows PowerShell 5.1 driver contracts                        | Six process, localization and navigation-priority contracts passed               |
| Released v0.1.5 ZIP launch, account login and chat             | Observed on x64 with synthetic account and mock inference                        |
| Real ZIP to MSIX retained-login migration                      | Passed on diagnostic source `00e438fc2b`; current-source reaccept pending          |
| In-app update and actual automatic NEW workspace               | Pending                                                                          |
| Preparation failure, OS cancellation and manual OLD reopen     | Pending                                                                          |
| Native uninstall preserving user data                          | Pending                                                                          |
| Windows 11 ARM64 native lifecycle                              | Pending                                                                          |
| Windows 10 22H2 native lifecycle                               | No test host available                                                           |
| Standard-user native lifecycle                                | Pending; elevated CI is not equivalent                                            |
| Production signing and ordinary-user trust                     | No production signing credentials available                                      |

The previous x64 reaccept run was
[`43771648784`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43771648784),
harness `9cfa1d343c`, using the exact previously signed production source
`00e438fc2bc391bba9cd2430037de075b24fdca9`.
It passed released ZIP chat and installed the first MSIX. The installed app
authenticated without re-login and exposed the seeded account/Bot history and
model settings. The external harness then failed to spawn a Python executable
inside `WindowsApps` (`EPERM`), before completing gateway and original ZIP-history
checks. This is not an accepted migration.

The observer now uses the preflighted fixture interpreter on Windows, where
external Node cannot execute a `WindowsApps` interpreter. It still imports the
installed gateway's discovery code and verifies the actual owner executable
against the exact installed interpreter. PID, birth time, account home, source
commit and selected listener checks remain required. POSIX observation still
uses the payload interpreter and dependencies. Real process and wrong-interpreter
contracts cover this distinction. The native NEW observation timeout also leaves
time for its DevTools and clipboard cleanup after all internal waits.

Corrected production source `ec74611f0d` is building x64/ARM64 in private run
[`43775234306`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43775234306).
The earlier x64/ARM64 run was
[`43767548248`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43767548248).
Its x64 pair completed signing, but its old model-response harness failed before
installation. ARM64 remains in progress. Private artifact retention is seven
days. No candidate has been promoted.

Earlier x64 execution verified and opened the historical ZIP, but its harness
failed after the expected reply because its idle-control locator recognized
only English. The current harness accepts exact English/Chinese primary controls
and retains its request witness, new-message and streaming-completion checks.
That earlier run does not prove installation or migration.

A subsequent compatibility review found that the checker invokes
`CheckUpdateAvailabilityAsync` on `Package.Current`. Microsoft's documented
[known issue](https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.package.checkupdateavailabilityasync#remarks)
requires resolving that same package through `PackageManager.FindPackageForUser`
first to avoid Access denied. The correction uses PyWinRT 3.2.1's actual
`find_package_by_user_security_id_package_full_name` method and includes the
Windows Deployment projection in the locked dependencies. Eighteen relevant
Python tests pass locally, with one native Windows probe skipped on Mac. The
Windows contracts job now includes that native projection probe. Previously
signed candidates do not contain this correction and cannot establish acceptance
of the corrected production source.

Fresh observer-change verification: complete `tests-js` checks passed (65 files,
376 tests, five host skips), full desktop typecheck passed, four gateway-health
Python contracts passed, and all 15 repository checks passed. Windows job
`133004500705` passed the new real-listener and expected-interpreter contracts
at harness `695dd00c8f`. The full local candidate/checker/health selection passed
67 tests, with two Windows-only tests skipped on Mac and covered by that job.
Job `133008078342` at `c345989a37` also passed all five driver contracts through
actual Windows PowerShell 5.1. This proves phrase selection and script encoding;
actual UI typing remains part of the complete native journey.

Diagnostic reaccept `43776705547` stopped before installation because the
selected artifact's overall origin workflow was still active. The origin
admission rule remains strict. `43777044333` instead uses the already completed
origin run's exact artifact `14181849856`, with signed source `00e438fc2b`.
This diagnostic source lacks the checker correction, so even a complete pass
cannot certify the corrected `ec74611f0d` production source.

Diagnostic run `43777044333` completed ZIP-to-first-MSIX migration. It retained
encrypted authentication without another login, verified the exact old chat
rows through the installed UI, naturally replaced the ZIP gateway, and passed
all 25 account/Bot/configuration/file preservation checks. It then failed:
descriptor-404 preparation recovery opened a manual-terminal-update card, and
the native update driver repeatedly selected About before Check now. Therefore
update, automatic NEW, cancellation and uninstall remain unaccepted.

`0eef5140dd` corrects navigation priority and busy-state waiting; Windows
job `133018750411` passed the expanded six driver contracts and the full existing
contract selection. `1598939d05` fixes the product's no-override apply path so an
unknown checker result rejects with its original error before preparation,
marker registration or teardown. Three regressions failed before that change
and passed afterward; 40 related Electron tests passed.

Current source `27bbc1d8f2` is building both architectures in private run
[`43783849762`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43783849762).
It also captures bounded raw checker output from the actual installed main
process before recovery apply. Four diagnostic/recovery contracts, full desktop
and harness typechecks, changed-file lint and all 15 repository checks passed.
Neither the diagnostic manual-card failure nor the screenshots distinguish
old API denial from missing package identity; that requires the new receipt.
Older signed pairs remain useful diagnostics but cannot certify this source.

Private contracts run
[`43784313536`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43784313536)
at harness `03e2136520` passed the complete updated Windows contract selection:
69 Python, 74 JavaScript (nine unrelated host skips), 71 updater/state, eight
native SDK cases, four descriptor tests and six Windows PowerShell 5.1 driver
contracts. The initial diagnostic fixture assumed the interpreter shared its
temporary volume; it now uses an existing sibling file to test path escape.
No production code or signed payload changed for that test correction.

## Public standard-runner receipts-only execution

Native execution on the public `OneWhitepaper/Aino` repository is allowed only
through the explicit `validation/windows-installer-public/**` branch prefix.
Pushing that feature branch starts fresh x64/ARM64 jobs on the standard
`windows-latest` and `windows-11-arm` runners; no default-branch merge is needed.
Normal public branches, pull requests, forks, self-hosted runners and implicit
public execution are rejected. Once GitHub exposes this workflow for dispatch,
the equivalent request is:

```sh
gh workflow run windows-installer-candidate.yml --repo OneWhitepaper/Aino \
  --ref validation/windows-installer-public/<feature> \
  -f public-receipts-only=true -f include-arm64=true
```

The dispatch input alone does not admit `main` or another branch prefix. Public
reuse inputs are rejected: the same existing builder creates a fresh test-signed
OLD/NEW pair in the ephemeral runner workspace, then uses the unchanged native
acceptance driver and signing-key/trust cleanup. Only `contents: read` and
`actions: read` are granted. There are no production signing secrets, paid larger
runners, release/feed uploads or installer publication.

Public artifacts contain only the generated
`aino-windows-public-receipts/receipts.json`, a typed projection of fixed source,
architecture, package digest/version and native gate/status fields. Candidate
build status, complete native acceptance and cleanup remain separate. The top-level
`status` is `accepted` only when candidate/package provenance, complete native
and supporting migration/automatic-NEW/recovery/state receipts, and successful
certificate cleanup all agree. Otherwise it is `unaccepted`, with fixed boolean
`acceptanceGates` identifying unmet evidence; copied candidate/native `accepted`
claims are downgraded. Missing or invalid receipts never establish acceptance.
Raw logs, screenshots,
account/environment/history payloads, certificates/state, private keys, installers,
ZIPs and the full workspace are never selected for public artifact upload. Raw
diagnostics stay in the ephemeral runner and the masked Actions console. Private
candidate/reuse artifact behavior and origin validation remain unchanged.

The new public path has not yet produced native acceptance evidence. Windows 10,
standard-user and production-trust claims still require their separate receipts.

## Remaining native receipts

The required end-to-end receipt is `proof/acceptance.json` with status `accepted`.
It must be accompanied by the original ZIP provenance and history receipt,
first-MSIX migration, Start entry, actual automatically relaunched NEW PID/window
and workspace, recovery scenarios, uninstall preservation and certificate cleanup.
A later driver-owned launch cannot replace automatic NEW observation.

Repeat the native lifecycle on a Windows 10 22H2 desktop and retain its actual OS
receipt. A 19045 manifest or a Server SDK run cannot establish that OS's runtime
compatibility. Before release, separately verify production-signed installation
and update without disposable test certificate trust.

## Windows 10 and standard-user handoff

Use a disposable Windows 10 22H2 desktop VM and a dedicated standard user. Record
the actual OS caption, build (`10.0.19045`), desktop product type, architecture,
App Installer version and user token. Use only synthetic account data. Do not
set CI admission variables to run CI-only scripts on an ordinary machine.

1. Obtain the exact private OLD/NEW pair containing the corrected source, its
   public certificate and source/hash receipts. Verify package identity,
   architecture, signer and validity. Candidate certificates expire after two
   days; rebuild expired candidates rather than changing the clock or trust checks.
2. An administrator may preinstall only that public certificate in
   `LocalMachine\\TrustedPeople`, retaining its thumbprint for cleanup. Sign out
   of the administrator. Installation, app execution, update and uninstall must
   then run under the standard user without elevation.
3. Use the existing descriptor writer and loopback feed helper to serve OLD
   through one `.appinstaller` URI. Use the isolated account/inference fixtures;
   keep the app's normal `%APPDATA%\\Aino` resolution within this dedicated user.
4. In released v0.1.5 ZIP, create a unique ordinary chat, Bot and model selection.
   Save the actual account home and durable message IDs. Close normally, leaving
   the gateway to its ordinary lifecycle. Install OLD through `.appinstaller` and
   launch from Start. Verify retained encrypted login, original data and natural
   old-gateway replacement.
5. Publish NEW at the same local descriptor URI. Trigger the update from Settings
   and observe package replacement and automatic app restart. Record OLD/NEW
   PID and birth time; inspect the actual automatic NEW before any manual launch.
   Verify account, home, history, model and a new completed chat turn.
6. From separate OLD VM snapshots, test descriptor HTTP 404 and an observed Aino
   App Installer cancellation. A preparation failure must leave the same window
   usable. A cancelled install must permit manual OLD reopen with retained login
   and data. Missing cancellation UI is unmet coverage.
7. Uninstall and verify package/Start registration removal with external data
   retained; reinstall and inspect that data. Save per-stage screenshots,
   package/source/hash, account-home and synthetic-history receipts, marking
   failed or untested steps explicitly.
8. Remove only this test's package and disposable data. An administrator removes
   only the recorded temporary certificate thumbprint. This establishes a
   pretrusted standard-user lifecycle, not production signing trust. Production
   installation without manually added trust requires its own acceptance.

### Existing helper commands for the manual handoff

The complete candidate/reaccept entry points, native driver and GUI environment
publisher require an elevated disposable Actions runner. They cannot certify a
local standard-user session. Do not fabricate `GITHUB_ACTIONS`, `RUNNER_*` or
`AINO_PRIVATE_*` to run them. The recipe below reuses their input, certificate,
feed and fixture helpers; it remains a manual acceptance awaiting a host and does
not generate the driver's automatic `proof/acceptance.json`.

Run tool commands from the repository root using the locked PM Python/Node;
prepare isolated, process-local `HERMES_HOME`/`HERMES_RUNTIME_DIR` and activate as
in the [developer workflow](../../../website/docs/reference/package-management.md#developer-workflow),
then run `just js-install-tests`. Ensure `openssl` is on PATH. Never persist those
tool-shell data-home overrides or launch Aino from the tool shell. Replace all
placeholders below, use a new absolute work directory, and record
`git rev-parse HEAD` as the harness revision separately from the baked source.

```powershell
$ErrorActionPreference = 'Stop'
$Repo = (Get-Location).Path
$Python = (Get-Command python.exe).Source
$Work = '<new-absolute-work-directory>'
$Repository = '<owner/private-repository>'
$Source = '<full-40-character-candidate-source-commit>'
$Arch = 'x64' # Match the actual host and candidate; use arm64 on ARM64.
$RunId = '<completed-origin-run-id>'
$ArtifactId = '<exact-candidate-artifact-id>'
New-Item -ItemType Directory -Path $Work | Out-Null
$Proof = Join-Path $Work 'proof'
New-Item -ItemType Directory -Path $Proof | Out-Null
gh repo view $Repository --json isPrivate,nameWithOwner |
    Set-Content -Encoding UTF8 "$Work\origin-repository.json"
if ($LASTEXITCODE -ne 0) { throw 'Private repository lookup failed' }
$facts = Get-Content -Raw "$Work\origin-repository.json" | ConvertFrom-Json
if (-not $facts.isPrivate -or $facts.nameWithOwner -cne $Repository) { throw 'Exact private repository required' }
gh api "repos/$Repository/actions/runs/$RunId" | Set-Content -Encoding UTF8 "$Work\origin-run.json"
if ($LASTEXITCODE -ne 0) { throw 'Origin run lookup failed' }
gh api "repos/$Repository/actions/artifacts/$ArtifactId" | Set-Content -Encoding UTF8 "$Work\origin-artifact.json"
if ($LASTEXITCODE -ne 0) { throw 'Artifact lookup failed' }
@'
import json, os, sys
from pathlib import Path
from scripts.ci.windows_candidate_reuse import validate_origin, relocate_manifest
from scripts.ci.windows_candidate_reaccept import download_archive, extract_inputs
work, repository, source, arch, run_id, artifact_id = sys.argv[1:]
work = Path(work)
artifact = json.loads((work / "origin-artifact.json").read_text(encoding="utf-8-sig"))
run = json.loads((work / "origin-run.json").read_text(encoding="utf-8-sig"))
origin = validate_origin(artifact, run, source, arch, int(run_id), int(artifact_id))
(work / "artifact-origin.json").write_text(json.dumps(origin, indent=2) + "\n", encoding="utf-8")
archive, inputs = work / "candidate.zip", work / "inputs"
download_archive(repository, int(artifact_id), artifact["digest"], artifact["size_in_bytes"], archive, dict(os.environ))
inputs.mkdir()
extract_inputs(archive, inputs)
relocate_manifest(inputs, source, arch)
archive.unlink()
'@ | & $Python - $Work $Repository $Source $Arch $RunId $ArtifactId
if ($LASTEXITCODE -ne 0) { throw 'Candidate origin, archive or input verification failed' }
$Inputs = Join-Path $Work 'inputs'
$m = Get-Content -Raw "$Inputs\reuse-inputs.json" | ConvertFrom-Json
```

Use an authenticated `gh` session with access to the exact private repository;
keep tokens out of commands and evidence. These existing functions bind the
completed origin workflow, source, architecture, artifact ID/name, expiry,
archive digest/size and package SHA-256 values. Extraction admits only these
five original files: `old.msixbundle`, `new.msixbundle`, `candidate-inputs.json`,
`candidate-public.cer`, `candidate-receipt.json`. Keep them unchanged under
`$Work\inputs`; `reuse-inputs.json` is a separate derived manifest with relocated
absolute paths. OLD/NEW must preserve identity/publisher/application ID and
increase native version. A failed but completed origin can supply packages;
its artifact is not a passing lifecycle receipt. Rebuild expired two-day
certificates instead of changing the clock or checks.

In a separate administrator shell at the same checkout, set the same explicit
`$Python` and `$Work`, then use the existing public-certificate helper:

```powershell
@'
import os, sys
from pathlib import Path
from scripts.ci.windows_candidate_reaccept import trust_candidate
print(trust_candidate(Path(sys.argv[1]) / "inputs", dict(os.environ)))
'@ | & $Python - $Work
if ($LASTEXITCODE -ne 0) { throw 'Candidate public certificate trust failed' }
```

It rejects private-key input, expired/not-yet-valid certificates, foreign
subjects/signers and preexisting trust, verifies both signatures after importing
only into `LocalMachine\TrustedPeople`, and writes the owned thumbprint to
`$Work\trust-state.json`. Sign out of the administrator; use only the standard
user for the lifecycle. In its tool shell retain these host/token facts and
confirm a non-administrator token, desktop `ProductType=1` and actual
`10.0.19045.*` for the Win10 claim (record Windows 11 separately):

```powershell
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,ProductType,OSArchitecture |
    ConvertTo-Json | Set-Content -Encoding UTF8 "$Proof\host.json"
Get-CimInstance Win32_Processor | Select-Object Name,Architecture |
    ConvertTo-Json | Set-Content -Encoding UTF8 "$Proof\processor.json"
Get-AppxPackage Microsoft.DesktopAppInstaller | Select-Object Name,Version,PackageFullName |
    ConvertTo-Json | Set-Content -Encoding UTF8 "$Proof\app-installer.json"
whoami /all | Set-Content -Encoding UTF8 "$Proof\token.txt"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Standard-user token required' }
```

In another PM-activated standard-user console at the same checkout, set the same
`$Work` and keep the existing combined inference/account fixture alive across
ZIP, OLD and automatic NEW. The second script argument is a prior-port
placeholder; the third is the account environment output:

```powershell
node tests/install/e2e-assets/mock-provider.mjs "$Work\mock-url" http://127.0.0.1:0 "$Work\account-env.json"
```

Wait for both files. Back in the first tool shell extract only the uppercase
keys below: the JSON also contains lowercase proxy aliases, which Windows
PowerShell 5.1 cannot decode as distinct keys. Save original User values,
including absent values, then write the fixture values and reuse only the
unguarded environment broadcast function:

```powershell
$fixture = @'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    values = json.load(source)
keys = ("HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_USE_ENV_PROXY", "NODE_EXTRA_CA_CERTS")
print(json.dumps({key: values[key] for key in keys}))
'@ | & $Python - "$Work\account-env.json" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Fixture environment extraction failed' }
$prior = @{}
foreach ($entry in $fixture.PSObject.Properties) {
    $prior[$entry.Name] = [Environment]::GetEnvironmentVariable($entry.Name, 'User')
}
$prior | ConvertTo-Json | Set-Content -Encoding UTF8 "$Proof\prior-user-environment.json"
foreach ($entry in $fixture.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'User')
}
. .\tests\install\e2e-assets\windows-native-environment.ps1
Send-NativeEnvironmentChange
$UserData = Join-Path $env:APPDATA 'Aino'
$AccountHome = @'
import { resolveDesktopHermesHome } from './apps/desktop/electron/data-paths.mjs'
console.log(resolveDesktopHermesHome({ home: process.env.USERPROFILE, accountWorkspace: {
  userData: process.argv[2], origin: 'https://api.agentera.com.cn', userId: '17'
} }))
'@ | node --input-type=module - $UserData
if ($LASTEXITCODE -ne 0) { throw 'Account home resolution failed' }
$MockUrl = (Get-Content -Raw "$Work\mock-url").Trim()
node tests-js/scripts/mock-provider-config.ts $AccountHome $MockUrl
if ($LASTEXITCODE -ne 0) { throw 'Account mock configuration failed' }
node tests/install/e2e-assets/released-windows-zip.mjs --arch $Arch --out "$Work\released-zip" --python $Python --report "$Proof\released-zip-artifact.json"
if ($LASTEXITCODE -ne 0) { throw 'Released ZIP provenance verification failed' }
```

Keep normal `%APPDATA%\Aino` and the account home returned by the production
resolver. A fresh dedicated user must have no existing Aino state or User
`HERMES_HOME`, `HERMES_DESKTOP_USER_DATA_DIR` or `HERMES_DATA_DIR_SUFFIX` override.
Do not change User `APPDATA`/`LOCALAPPDATA` or import the fixture CA into a store.
Open the verified ZIP executable recorded in `released-zip-artifact.json` from
File Explorer. Sign in with `+8613800138000`, accept the fixture agreement, select
keep signed in, request a code and enter `246810`. Create the unique chat/Bot/model
evidence in checklist step 4 and retain actual account-home/session/message IDs.

A User environment write and broadcast do not prove GUI inheritance. For the
Explorer-launched ZIP, Start-launched OLD and actual automatic NEW, retain the
main-process PID/birth time, the five inherited fixture values and authenticated
fixture request/mock-response witnesses. If that binding cannot be established,
mark the stage untested. A tool-shell launch cannot substitute for Start or
automatic NEW. Keep the fixture console running; use Ctrl+C at the end so it
writes `account-env.json.proof.json`, and retain that proof without tokens.

In a third standard-user tool console at the same checkout, set the same `$Work`
and keep the existing byte-range-capable loopback feed running:

```powershell
node tests/install/e2e-assets/windows-bundled-helpers.mjs serve --feed "$Work\feed" --port-file "$Work\feed-url"
```

After its URL file exists, return to the first shell. These `descriptor` commands
call the existing local XML writer; they do not publish to a release service:

```powershell
$Feed = Join-Path $Work 'feed'
Copy-Item "$Inputs\old.msixbundle","$Inputs\new.msixbundle" -Destination $Feed
$Base = (Get-Content -Raw "$Work\feed-url").Trim()
$Helper = Join-Path $Repo 'tests\install\e2e-assets\windows-bundled-helpers.mjs'
$Shared = Join-Path $Repo 'scripts\msix-shared.mjs'
$env:HERMES_PYTHON = $Python
node $Helper descriptor --feed $Feed --base-url $Base --identity $m.old.identity --publisher $m.old.publisher --version $m.old.version --bundle old.msixbundle --msix-shared $Shared
if ($LASTEXITCODE -ne 0) { throw 'OLD descriptor failed' }
if (Get-AppxPackage -Name $m.old.identity) { throw 'Refusing to replace an existing package' }
Add-AppxPackage -AppInstallerFile "$Feed\update.appinstaller"
# Perform checklist step 4 from the actual Start entry before continuing.
node $Helper descriptor --feed $Feed --base-url $Base --identity $m.new.identity --publisher $m.new.publisher --version $m.new.version --bundle new.msixbundle --msix-shared $Shared
if ($LASTEXITCODE -ne 0) { throw 'NEW descriptor failed' }
```

For each installed stage compare `Get-AppxPackage -Name $m.old.identity`,
`Get-AppxPackageManifest` and `app\resources\install-stamp.json` with the pinned
identity, architecture, application ID, version, tag and source. Retain the
matching `Get-StartApps` entry. Observe automatic NEW before any manual launch.
For the separate preparation-failure snapshot, first let Settings report NEW
available, then move `update.appinstaller` to `update.appinstaller.recovery-held`
before clicking update. Require the apply preparation's real descriptor HTTP
404, the same usable OLD process/window, no pending relaunch marker and another
completed chat. Restore the descriptor in every outcome. A 404 before the
availability check does not test this gate. Cancellation requires an observed
Aino-bound App Installer window; missing UI is unmet coverage. Uninstall only
the exact current-user package returned by `Get-AppxPackage -Name
$m.old.identity`, then verify external data survives uninstall/reinstall.

Save `proof/manual-acceptance.json` separately from automatic driver receipts.
Use `passed`, `failed` or `untested` per stage and retain screenshots, native
package/stamp facts, process birth times, account-home/history rows, gateway
owner replacement, fixture requests and cleanup receipts. This template starts
pending; it is not a passing receipt:

```json
{
  "kind": "manual-windows-native-lifecycle", "status": "pending",
  "harnessCommit": "<full SHA>", "testedSourceCommit": "<full SHA>",
  "artifactOrigin": "../artifact-origin.json", "candidateInputs": "../inputs/candidate-inputs.json",
  "host": "host.json", "processor": "processor.json", "appInstaller": "app-installer.json", "token": "token.txt", "isElevated": false,
  "trust": { "mode": "pretrusted-test-certificate", "receipt": "../trust-state.json" },
  "fixtureBinding": { "zip": "untested", "oldStart": "untested", "automaticNew": "untested", "evidence": [] },
  "releasedZip": { "status": "untested", "artifact": "released-zip-artifact.json", "accountHome": "", "sessionIds": [], "messageIds": [] },
  "migration": { "status": "untested", "gatewayOwners": [], "evidence": [] },
  "update": { "status": "untested", "oldPid": null, "oldBirthTime": null, "newPid": null, "newBirthTime": null, "automaticNewObservedBeforeManualLaunch": false, "evidence": [] },
  "preparation404": { "status": "untested", "sameOldProcess": false, "evidence": [] },
  "cancelManualReopen": { "status": "untested", "installerObserved": false, "evidence": [] },
  "uninstallReinstall": { "status": "untested", "dataRetained": false, "evidence": [] },
  "cleanup": { "userEnvironmentRestored": false, "ownedPackageAndDataRemoved": false, "testCertificateRemoved": false },
  "productionTrustTested": false
}
```

On success or failure, restore the exact saved User values and broadcast again;
stop the two owned consoles and remove only this test's package and dedicated
user data after retaining evidence:

```powershell
$prior = Get-Content -Raw "$Proof\prior-user-environment.json" | ConvertFrom-Json
foreach ($entry in $prior.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($entry.Name, $entry.Value, 'User')
}
Send-NativeEnvironmentChange
```

Finally, in the separate administrator shell at the same checkout, use the
existing cleanup to remove only the certificate owned by `trust-state.json`:

```powershell
@'
import os, sys
from pathlib import Path
from scripts.ci.windows_candidate_reaccept import cleanup_trust
cleanup_trust(Path(sys.argv[1]), dict(os.environ))
'@ | & $Python - $Work
if ($LASTEXITCODE -ne 0) { throw 'Owned candidate trust cleanup failed' }
```

This handoff establishes only a pretrusted standard-user lifecycle. Production
installation/update without manually added trust needs separate acceptance.

The account fixture uses the real desktop bridge and encrypted local token store,
but synthetic authentication and mock inference. It does not certify production
SMS, billing or platform-model availability. See [BUILDING.md](../BUILDING.md)
for packaging and update ownership.
