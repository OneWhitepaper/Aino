# Windows installation and update acceptance

Status: implementation complete; native acceptance in progress. Distribution is
held. This document does not authorize publishing installers or production feeds.

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

| Check                                                          | Result                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Local updater, manifest and data-preservation contracts        | 63 passed                                                 |
| Local candidate, fixture and runner Python contracts           | 51 passed; one Windows-only skip                          |
| Local release artifact and bundle naming contracts             | 13 passed                                                 |
| Complete tests-js typecheck, tests and ESLint                  | Passed; 376 tests, five platform skips                    |
| Complete desktop renderer, Electron, E2E and builder typecheck | Passed                                                    |
| Repository `scripts/check`                                     | All 15 checks passed                                      |
| Independent production and acceptance review                   | No P1/P2 findings                                         |
| Native SDK pack/unpack at 19045 floor                          | Eight cases passed on Windows Server 2025                 |
| Windows Python and acceptance-harness contracts                | 48 Python and 71 JS passed; nine platform skips           |
| Windows updater/state and descriptor contracts                 | 68 updater/state and four descriptor tests passed         |
| Released v0.1.5 ZIP launch, account login and chat             | Observed on x64 with synthetic account and mock inference |
| Real ZIP to MSIX retained-login migration                      | Pending                                                   |
| In-app update and actual automatic NEW workspace               | Pending                                                   |
| Preparation failure, OS cancellation and manual OLD reopen     | Pending                                                   |
| Native uninstall preserving user data                          | Pending                                                   |
| Windows 11 ARM64 native lifecycle                              | Pending                                                   |
| Windows 10 22H2 native lifecycle                               | No test host available                                    |
| Production signing and ordinary-user trust                     | No production signing credentials available               |

The active x64 reaccept run is
[`43771648784`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43771648784),
harness `9cfa1d343c`, using the exact previously signed production source
`00e438fc2bc391bba9cd2430037de075b24fdca9`.
Full x64/ARM64 builds remain in private run
[`43767548248`](https://github.com/OneWhitepaper/Aino-private-validation-20261105/actions/runs/43767548248).
Private artifact retention is seven days. No candidate has been promoted.

Earlier x64 execution verified and opened the historical ZIP, but its harness
failed after the expected reply because its idle-control locator recognized
only English. The current harness accepts exact English/Chinese primary controls
and retains its request witness, new-message and streaming-completion checks.
That earlier run does not prove installation or migration.

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

The account fixture uses the real desktop bridge and encrypted local token store,
but synthetic authentication and mock inference. It does not certify production
SMS, billing or platform-model availability. See [BUILDING.md](../BUILDING.md)
for packaging and update ownership.
