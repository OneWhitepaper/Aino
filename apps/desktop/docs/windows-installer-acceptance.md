# Windows installation and update acceptance

Status: diagnostic public run `43846856927` at `c0ff3179dc` failed both
x64 and ARM64 native legs before package replacement. Windows contracts passed.
Both observers confirmed unchanged OLD registration throughout their budgets;
automatic NEW has not been accepted. Fresh run `43866276951` at `385b1b3453`
is still building/running, with no accepted native receipt. Earlier run
`43819576334` failed/stalled at that stage and was cancelled. Neither architecture has a complete accepted
native lifecycle. Distribution is held; this document does not
authorize installer, release, feed or website publication, or a merge to `main`. The user
authorized test-signing acceptance first; production signing and ordinary
production trust remain deferred to release preparation.

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

| Check | Result |
| --- | --- |
| Public receipts-only mode and complete acceptance projection (`006d35b6b3`) | 111 Python passed; two native Windows skips on Mac; independent review clean |
| Source-only checker contracts (`f5d12ce3dc`) | 29 Python passed; one native Windows projection probe skipped on Mac |
| Related Electron updater/checker/descriptor contracts (`f5d12ce3dc`) | 72 passed across six files |
| Full desktop typecheck, changed-file lint, repository checks and independent review (`f5d12ce3dc`) | Passed; review found no Critical/Important findings |
| Public Windows contracts (`f5d12ce3dc`, run `43801657955`, job `133083110675`) | SUCCESS: 145 Python (four skips), 74 JS (nine skips), eight extractor, eight SDK, 113 updater/state across 14 files, seven Windows PowerShell 5.1 groups, GUI-environment suite and four descriptor tests passed |
| Follow-up Windows contracts (`3fd5e9c26c`, run `43819576334`, job `133139302779`) | SUCCESS: existing suites plus real UIA About binding, foreign-window refusal and disabled-control checks passed on Windows PowerShell 5.1 |
| Diagnostic Windows contracts (`c0ff3179dc`, run `43846856927`, job `133229083523`) | SUCCESS: 149 Python (four skips), existing JS/SDK/updater/state/UIA contracts and all seven native-observation tests passed, including real PowerShell provenance/process queries and killed-child deadlines |
| Focused Windows provider/timeout contracts (`6bd68031f5`, run `43873843738`, job `133321640396`) | SUCCESS: explicit framework UIA registration changes the same Win32 control from Pane to Button; all existing Python/JS/SDK/updater/native-observation suites passed |
| Diagnostic x64/ARM64 package reproduction (`c0ff3179dc`, run `43846856927`) | Both failed at unchanged OLD registration; no automatic NEW; both owned-package and disposable-trust cleanups succeeded |
| Follow-up x64/ARM64 package acceptance (`3fd5e9c26c`) | x64 failed at the 15-minute replacement/automatic-NEW wait; ARM64 was cancelled after 29 minutes with no progress in that phase; neither accepted |
| Public x64 and ARM64 signed OLD/NEW packages (`f5d12ce3dc`) | Built, test signed and verified; native lifecycle failed later |
| Released v0.1.5 ZIP chat and first-MSIX migration | Passed on both architectures: encrypted login without re-login, original chat history, natural gateway rotation and all 25 data checks |
| Actual installed PackageManager update query | Both architectures returned exit 2, `AVAILABLE`, registered loopback source and empty stderr |
| Preparation HTTP404 recovery | Passed on both architectures: real descriptor HTTP404, same usable OLD process and intact state |
| Actual Update trigger | Both failed before handoff: `AutomationElement` has no `Compare` method |
| Automatic NEW, observed OS cancellation/manual OLD reopen, final uninstall/reinstall | Not reached; no complete accepted receipt |
| Disposable signing key/trust cleanup | Recorded removed on both architectures; both public receipts remain `unaccepted` |
| Runtime host coverage | x64: Windows Server 2025; ARM64: Windows 11 ARM64. Windows 11 x64 desktop and Windows 10 19045 desktop remain untested |
| Standard-user lifecycle and production trust | Untested; both hosted jobs were elevated; only test signing is authorized |

The completed public run
[`43801657955`](https://github.com/OneWhitepaper/Aino/actions/runs/43801657955)
tested signed source `f5d12ce3dcc253cd9bc3dc9e070e2b88f747da5f`. Native x64 job
`133083109738` and ARM64 job `133083108952` both passed released ZIP migration,
the 25 preservation checks and actual HTTP404 preparation recovery. The prior
source-only apply correction therefore passed this native recovery scenario.

Both jobs then failed at `Show-UpdateAbout`: the driver called
`System.Windows.Automation.AutomationElement.Compare`, which does not exist.
The documented API is `System.Windows.Automation.Automation.Compare`. Pure
navigation contracts had passed because they did not call the Windows UIA API.
This is an acceptance-driver defect; the logs do not establish a failure of the
actual native update handoff, which was not reached.

The correction uses that documented API and exercises the actual helper against
owned native Windows controls: the About element must bind to an independently
resolved instance of its own window, reject another window, and reject a disabled
button. The driver retains its original process identity guard before scrolling.
Local PowerShell 7.5.4 parsing, seven pure contract groups and all 15 repository
checks pass. The native UIA group is skipped on Mac and passed on actual Windows
PowerShell 5.1 in job `133139302779` of follow-up run
[`43819576334`](https://github.com/OneWhitepaper/Aino/actions/runs/43819576334).
That job completed successfully; the package jobs subsequently failed/stalled at
replacement/automatic NEW as detailed below.
UTF-8 BOM and CRLF remain in the Windows scripts. The successful owned-control
regression does not establish the installed application's complete lifecycle.

Work continues only in `aino-windows-native-acceptance/Aino`, branch
`codex/windows-native-acceptance`, based on `b121c42af7`. The other chat's browser
fix `0334597e83` in `aino-windows-installer/Aino` is excluded and preserved.
Neither the other chat's files nor its desktop process are used by this run.

Earlier private runs, including completed failed run `43783849762`, are
historical diagnostics. They cannot certify the latest source. Earlier transport,
localized composer and process-observation fixes remain in the existing harness.
Windows Server SDK pack/unpack at a 19045 manifest floor is not Windows 10 desktop
or Windows 11 x64 desktop runtime evidence. No candidate has been promoted.

## Public standard-runner receipts-only execution

The public receipts-only implementation and fail-closed 13-gate completeness
projection at `006d35b6b3`, and the native fixes at `f5d12ce3dc`, passed independent
review. The root pushed `f5d12ce3dc` to
`OneWhitepaper/Aino:validation/windows-installer-public/20261116`, starting
[`43801657955`](https://github.com/OneWhitepaper/Aino/actions/runs/43801657955).
Its contracts job `133083110675` completed successfully. Both native jobs have
completed with failures at the same UIA method call, after migration and HTTP404
preparation recovery passed. Public standard-runner admission was not blocked
by the private-repository billing limitation.
The opt-in ref remains frozen at `f5d12ce3dc`; documentation updates use a separate
ref so they do not restart the two package builds.

The UIA correction `3fd5e9c26c` uses a new frozen opt-in ref,
`validation/windows-installer-public/20261116-uia-binding`, for follow-up run
`43819576334`. Its contracts job passed, including real Windows UIA execution;
the x64 native job failed and the stalled ARM64 job was subsequently cancelled.
Later documentation commits use the ordinary `codex/windows-native-acceptance`
ref and do not restart those builds.

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
OLD/NEW pair in the ephemeral runner workspace, then uses the existing native
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

Both preceding and follow-up public native receipts are `unaccepted`. The
standard x64 runner is Windows Server 2025; the ARM64 runner is Windows 11 ARM64.
Neither establishes Windows 11 x64 desktop, Windows 10 19045 desktop,
standard-user or production-trust acceptance.

## Completed follow-up and stalled update handoff

Follow-up run [`43819576334`](https://github.com/OneWhitepaper/Aino/actions/runs/43819576334)
used `3fd5e9c26c` on standard hosted runners. The real UIA regression and all
Windows contracts passed in job `133139302779`.

- x64 job `133139303070` completed with failure at 08:23 UTC. It passed ZIP chat,
  first-MSIX migration, all 25 preservation checks and preparation HTTP404
  recovery. The UIA driver clicked the actual Update action, observed OLD exit,
  and then the replacement/automatic-NEW observation failed after 15 minutes.
  No App Installer confirmation dialog was observed on this host. The combined
  error does not identify whether deployment or activation was responsible.
- ARM64 job `133139303136` built and test signed both packages, completed ZIP
  chat, first-MSIX migration and preparation recovery according to the console,
  clicked the actual in-app Update action and the observed App Installer Update
  confirmation, and observed OLD exit. Its last progress was 09:04:09 UTC at
  replacement/automatic NEW. There was still no new progress at cancellation
  09:33:18 UTC, beyond the outer loop's nominal 15-minute deadline. This proves
  stalled progress, not which native query or teardown operation was blocking.
- The controller cancelled the stalled run; ARM64 ended `cancelled` at 09:34:08
  UTC. Both public receipts remain `unaccepted`. Disposable certificate/key trust
  cleanup recorded removed on both architectures. ARM64's migration receipt was
  not flushed before cancellation, so its public migration gate is false even
  though the earlier console stage had passed. Console progress is not promoted
  into a complete accepted receipt.
- Safe receipt artifact IDs are x64 `14208288195` and ARM64 `14213375765`. Full
  job logs were downloaded to task-local scratch files
  `aino-public-43819576334-x64.log` and `aino-public-43819576334-arm64.log`;
  only curated receipts are public
  artifacts. Raw waiter and deployment failure evidence is not present in those
  public receipts, so no production fix is inferred from this combined timeout.

The follow-up diagnostic change separates package replacement from automatic NEW.
The existing journey now queries package provenance and process identity in owned
PowerShell children, each bounded to 20 seconds within a monotonic 15-minute budget.
A separate observer supervisor stops its owned diagnostic tree after 940 seconds;
deployment-event collection has a separate ten-second limit and disposable-package
cleanup has a 90-second limit. Neither observer nor supervisor launches the app or
installer. A successful observation still requires the manifest/stamp-verified
NEW executable, one fresh main PID and a later birth time than OLD.

The observer writes progress before each native query and emits a heartbeat every
30 seconds. Its receipt distinguishes package/query failures from waiting for a
new process, counts remaining OLD payload processes and binds waiter progress to
the exact OLD PID, identity and attempt time. The production waiter adds stage
logging only; gateway lifecycle semantics are unchanged. A surviving canonical
gateway holding OLD package files remains a hypothesis until native process and
deployment evidence establishes it. The public projection exposes only fixed
stages, typed counts/versions and validated HRESULTs, and does not relax any of
the 13 acceptance gates. Successful migration evidence is flushed before the
update, and recovery receipts are flushed before cleanup.

Local child-timeout, phase/provenance, safe-projection tests and PowerShell parsing
are covered; actual Windows probes are also wired into the existing contracts job.
Local verification passed 81 Python tests (two Windows skips), five Node tests
(two Windows skips), all five PowerShell parser checks and all 15 repository checks.
Commit `c0ff3179dc` is frozen on
`validation/windows-installer-public/20261116-native-observation` for run
[`43846856927`](https://github.com/OneWhitepaper/Aino/actions/runs/43846856927).
Windows contracts job `133229083523` passed, including all seven observation tests
on the actual host. The x64 leg completed with failure at 11:42 UTC; ARM64
remains in progress. The failure evidence below distinguishes package
replacement from activation, but does not establish a successful update.
Automatic NEW, cancellation/manual reopen and
final uninstall/reinstall preservation are still not accepted. Distribution and
`main` remain unchanged, and the other chat's worktree and desktop process remain
untouched.

A subsequent harness correction removes the second, unbounded CIM/port scan
after NEW starts. The existing automatic-window observer already verifies the
retained account and history, then checks its selected local gateway's exact
installed Python, package stamp and `/api/health` commit with bounded probes.
Cleanup likewise relies on the existing bounded removal verification instead
of repeating `Get-AppxPackage` in the parent. The selected-gateway and native
handoff contracts passed locally (eight JavaScript and 17 Python tests; one
Windows-only Python skip), as did PowerShell parsing. These follow-up changes
are not included in frozen run `43846856927` and need native reacceptance.

The initial live-log view remained on final bundle signing; later loaded output
showed migration had already completed. That view alone does not establish a
stalled signer or its duration. A follow-up harness change records
minute-by-minute activity of the exact owned child (CPU, memory,
available I/O counters and output size) and retains a final progress receipt.
Signing, bundle creation and signature verification each have a 30-minute
budget instead of inheriting the five-hour complete-build budget. Real-child
timeout/reaping and pre-exit heartbeat tests were first red, then passed with
the existing candidate contracts (46 passed, one Windows skip). Those additions
are also outside the current frozen run and do not certify native acceptance.

### Completed x64 diagnosis and next bounded checks

The x64 leg reached the actual replacement observer at 11:26:47 UTC, after ZIP
migration, 25 state checks and preparation recovery passed. It completed 282
samples by 11:41:49 UTC with package/process queries working, OLD version
`2026.7666.791.0` unchanged, one OLD payload process, no OLD main process, one
installer process and no NEW main process. The relaunch waiter progressed from
`query-started` to `package-timeout`. The final bounded deployment query
succeeded but found no matching deployment events or HRESULTs. The package
cleanup succeeded and certificate/trust cleanup recorded `removed`. Curated
receipt artifact `14222743163` is `unaccepted`.

This establishes failure before package replacement. It does not identify the
remaining payload process as the cause or establish that activation itself is
broken. No gateway shutdown or forceful production update change is inferred.
ARM64 also failed at package replacement. After first-MSIX migration and
preparation recovery passed, it observed 250 complete samples with unchanged
OLD `2026.7666.1523.0`, one OLD payload process, no OLD/NEW main process and
two installer processes. Its waiter reached `package-timeout`; the event query
succeeded without matching events or HRESULTs. Receipt artifact `14226887326`
is `unaccepted`; owned-package cleanup and disposable certificate/trust cleanup
succeeded. These observations still do not identify the replacement cause.

The last shortened probe in x64 exhausted the overall observation budget and
incorrectly overwrote the confirmed OLD state with `package-query-timeout`.
The follow-up distinguishes `deadlineOperation` from a native query's own
20-second deadline and preserves the last complete sample. A real child-process
regression reproduced that classification error before the fix.

The follow-up also reuses the existing strict cancellation window binding for
confirmation: inspect every verified App Installer window, exclude windows
visible before this attempt, bind the product, and refuse ambiguous matches.
The earlier confirmation branch considered only the first top-level window and
reported that no dialog appeared even when a window had been observed without
an actionable button. New typed trigger receipts distinguish these states.
Raw window/control snapshots remain local. An owned native-control regression
covers helper/foreign windows, existing windows and disabled confirmation;
native fixture verification is tracked below.

Package/process heartbeats now count remaining Python, Node and other OLD
payload processes and retain exact PID, parent, path and birth facts only in
local diagnostics. On observation failure a separate 15-second UIA probe records
visible/matching installer windows and confirmation availability; together with
the ten-second event query it remains within the 940-second observer supervisor.
Both update/cancel UIA drivers now use the existing owned-job supervisor with
an 18-minute deadline. A stuck provider cannot turn the UIA polling budget into
an unbounded native wait. The 13 acceptance gates and public artifact selection
are unchanged; arbitrary window/process text is never projected.

The first focused run
[`43864177745`](https://github.com/OneWhitepaper/Aino/actions/runs/43864177745)
at `2c747067ee` correctly skipped candidate builds, but failed before UIA tests.
The actual Windows venv `python.exe` launcher (PID 5940) owned the real worker
(PID 8420); the timeout terminated only the launcher and the worker survived.
This is a candidate-supervision defect, independent of the unproven package
replacement cause. The shared Hermes process-tree cleanup now handles logged
commands; the existing bounded probe/Windows Job Object path handles captured
commands. Real grandchild fixtures first reproduced the leak in both paths,
then passed on Mac; a live independent sibling is preserved. Tests no longer
mistake a launcher's PID for its worker. All four actual timeout/tree cleanup
regressions passed on Windows in run `43866276951`. The earlier local
verification passed 124 Python tests (two Windows skips),
seven observer Node tests (two Windows skips), four descriptor tests, eight
selected-gateway/handoff tests and PowerShell parsing.

Run [`43866276951`](https://github.com/OneWhitepaper/Aino/actions/runs/43866276951)
freezes `385b1b3453` on
`validation/windows-installer-public/20261116-installer-window/reaped-launchers`.
It starts full fresh x64/ARM64 candidates as well as contracts; neither package
leg has a final receipt yet. Native Python contracts passed 158 tests (four
host skips), including all four real timeout/tree-ownership regressions. The
next JS step hit an existing native listener test's 5-second default while it
performs three 30-second-bounded OS scans; 73 other JS tests passed. The follow-up
sets a 120-second test budget while preserving every scan and ownership assertion.
The focused Windows run `43867819708` passed this JS step with the corrected
budget; candidate builds at `385b1b3453` remain independent.

Installer-window diagnostics also extract only bounded, validated HRESULTs from
the identified product's window/control text. They can expose a native error
when deployment events are absent without uploading arbitrary UI text.

Focused run `43867819708` at `c4e84dec21` passed the native Python, JS
harness, SDK and updater suites, then failed the new owned-window UIA fixture.
Later runs established that its Update control was enabled/on-screen but
exposed as `ControlType.Pane`, even for a standard Win32 BUTTON. A separate STA
UI owner/message pump (`43872149732`) did not fix this, ruling out UI-thread
isolation as the sufficient cause. The fixture keeps that separation to follow
Microsoft's [UIA threading guidance](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-threading-issues).

Run `43873843738` at `6bd68031f5`, job `133321640396`, succeeded. Its same
owned control changed from `Pane`, class `Button`, framework `Win32`, no
patterns, to `ControlType.Button` after explicit registration of Microsoft's
signed `UIAutomationClientsideProviders` assembly. This establishes the missing
client-side provider initialization in this PowerShell UIA context. The shared
initializer now serves both the actual update driver and final installer probe;
the strict Button/product/process/new-window filters remain unchanged. Native
contracts covered helper/foreign windows, previous-window rejection, enabled
and disabled confirmation, HRESULT projection and owned-fixture cleanup. The
successful run also passed 158 Python (four skips), 74 JS (nine skips), eight
extractor cases, eight SDK cases, 113 updater/state tests and the existing
PowerShell/observation/environment/descriptor suites. The shared-initializer
integration still requires the latest-source focused Windows receipt. This
fix does not yet prove the cause of the earlier package-replacement stall.

Launcher-only heartbeats also concealed real descendant activity. A real nested
worker regression failed before the process-tree metrics and then passed with
all 125 related Python tests on Mac (two Windows skips). Root counters remain
separate; tree CPU, RSS, optional I/O and sampled-versus-discovered process
counts identify partial observations without publishing commands/environment.
Latest-source Windows revalidation of this addition is pending.

A public opt-in ref ending in `/contracts-only` runs the standard Windows
contracts without the two large candidate builds. Use that focused native
verification before another full package run. Ordinary and frozen refs stay
separate; no prior run is silently replaced.

## Remaining native receipts

The required end-to-end receipt is `proof/acceptance.json` with status `accepted`.
It must be accompanied by the original ZIP provenance and history receipt,
first-MSIX migration, Start entry, actual automatically relaunched NEW PID/window
and workspace, recovery scenarios, uninstall preservation and certificate cleanup.
A later driver-owned launch cannot replace automatic NEW observation.

Retain separate actual OS receipts for Windows 11 x64 desktop and Windows 10
22H2 desktop, and a standard-user lifecycle receipt. A 19045 manifest or Server
SDK run cannot establish those desktop runtime claims. Production-signed
installation and update without disposable test trust remain a separate,
deferred release-preparation acceptance.

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
