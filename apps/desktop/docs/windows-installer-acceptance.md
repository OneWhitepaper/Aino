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
| Windows Python and acceptance-harness contracts                | 69 Python and 73 JS passed; nine platform skips                                  |
| Windows updater/state and descriptor contracts                 | 68 updater/state and four descriptor tests passed                                |
| Windows PowerShell 5.1 driver contracts                        | Five process/English/Chinese confirmation contracts passed                       |
| Released v0.1.5 ZIP launch, account login and chat             | Observed on x64 with synthetic account and mock inference                        |
| Real ZIP to MSIX retained-login migration                      | Partial: first MSIX installed, retained login observed; complete journey pending |
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

The account fixture uses the real desktop bridge and encrypted local token store,
but synthetic authentication and mock inference. It does not certify production
SMS, billing or platform-model availability. See [BUILDING.md](../BUILDING.md)
for packaging and update ownership.
