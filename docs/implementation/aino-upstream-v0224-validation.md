# Aino / Hermes v0.22.4 integration validation

## Revision and scope

- Aino baseline: `3369bd314f0806a378cadc790c5adf14dba5a304`.
- Exact upstream release: `4d04303818b61bf3aa09278af48356315515965b`.
- Integration branch: `codex/aino-upstream-v0224`.
- Full release merge, retaining upstream history. This is a source integration, not an installer publication.
- Daily profiles, hosted download feeds, and production deployments are outside this operation.

## Compatibility decisions

- Keep the upstream canonical gateway as the local owner. Desktop connections are viewers, not independently owned gateway processes. Aino's existing connection limits now govern speculative connections and idle retention.
- Preserve Aino account/model/billing authority, fixed palette and compact response presentation, project-folder workflows, Summary, managed context limits, and existing Hermes delegation.
- Restore composer suggestions and resource status through the existing stores and controls rather than creating parallel UI systems.
- Place Aino native message sidecars and mode metadata in the upstream `SessionApiContentMixin`. Direct writes and worker receipts use the same transaction writers and session/row/content guards.
- Restore managed model metadata, runtime route synchronization, custom-provider collision recovery, and cold context usage in the extracted upstream modules. Compression and resume retain their current model source.
- Notifications mark completion only after admission, refund rejected durable claims, and avoid requeuing consumed completion copies.
- macOS Python signing applies only to Darwin target artifacts. Cross-target Bionic staging must leave foreign binaries untouched.
- Restore standard GitHub-hosted runner labels and pinned checkout/Docker actions in all imported workflows; keep every test lane and native architecture.
- Retain exact upstream provenance in contributor, plugin-catalog, and code-health checks. Inherited upstream findings remain in the report; new integration regressions remain blocking.

## Local validation to date

All Python tests use `scripts/run_tests.sh` with PM Python 3.14.7 and isolated state in the temporary verification home. No paid model request is part of these checks.

| Check | Result |
| --- | --- |
| Desktop renderer full suite | 1,484 files, 12,341 passed |
| Electron full suite | 403 passed files / 9 host-skipped; 3,857 passed / 37 skipped tests |
| TUI full check | 1,826 passed / 28 skipped; typecheck, key check and lint passed |
| Web full check | 449 passed; typecheck and lint passed |
| Desktop typecheck / lint | Passed; lint warnings retained, zero errors |
| Desktop production build | Passed on macOS arm64 |
| Gateway generated contracts | Existing freshness tests passed |
| Static guards excluding health | 11 checks passed |
| Worker sidecar/parity/Ultra focus | 46 passed; adjacent persistence focus 41 passed |
| Managed model / context persistence | 84 passed across five files; adjacent server suite 633 passed |
| Notification admission/recovery | 19 TUI tests and 39 async delegation tests passed |
| Python failure inventory + canonical integration consolidated rerun | 31 files, 469 passed, 37 skipped, zero failures; retries disabled |
| Root JavaScript | 40 files, 257 passed / 4 skipped; typecheck and lint passed |
| Real Electron chat/project/appearance | 13 scenarios passed |
| Native fixture transport guard | Passed; Electron/Chromium external transport and Python credential reads denied |
| Canonical sessions and managed models adjacent regression | 147 files, 757 passed / 54 skipped; retries disabled |
| CI workflow behavior contracts | 636 passed / 71 host-skipped |
| Native fixture proof helpers | 3 passed |
| Native compression/restart and billing continuity | 1 complete scenario passed in 1.4 minutes; 90 adjacent compression tests passed |
| Real account/model/tool/billing native chain | 1 complete scenario passed in 3.4 minutes; includes restart, workspace/multiwindow, custom-provider and website wallet |

The first full Python run covered 6,625 files: 65,625 passed, 77 failed, 1,873 skipped, plus one collection error. It ran while compatibility fixes were in progress, so it is a baseline failure inventory, not a final green result. The collection error was missing the optional FAL SDK in the local test environment; PM installed the already-declared `fal` extra, after which all 38 SDK tests passed. CI already selects that extra.

Six files passed only on the full run's automatic retry (API authority execution/retry, shared clarification, kanban, and two offline Ultra harness suites). A separate two-worker run with automatic retries disabled passed all 38 tests in those six files. Their first failures were startup/request deadlines under concurrent load; this does not establish that their timing sensitivity is eliminated.

## Outstanding acceptance

- Canonical native Desktop transport must preserve Aino managed model creation and credential binding. Review found the upstream create contract rejecting Aino model identity fields and its session fallback correctly refusing legacy writers; compatibility has been added through the existing owner and ManagedModelRegistry. The Electron controller now reuses native gateway ticket issuance, sends the ticket as the existing WebSocket subprotocol, and preserves the selected profile. The native fixture has passed authorization, tools, cancellation, restart, workspace switching, and custom-provider routing; the final combined rerun passed (one complete scenario, 3.4 minutes), including the independent website wallet and secret/transport audit.
- Development Electron E2E needs the PM test interpreter as `HERMES_DESKTOP_PYTHON` and `node apps/desktop/scripts/bundle-electron-main.mjs --dev` for the explicit legacy-account test adapter. A release bundle deliberately disables that adapter. Run through `scripts/run-in-hermes-env bash -c 'cd apps/desktop; export HERMES_DESKTOP_PYTHON="$__HERMES_TEST_PYTHON"; npx playwright test e2e/project-navigation.spec.ts e2e/appearance-modes-only.spec.ts e2e/chat.spec.ts --reporter=line --output="$TMPDIR/aino-v0224-project-results"'`. After the cold tile resumed its canonical cwd and the E2E waited for the restored PTY to attach, all 13 affected scenarios passed.
- Committed merge `15299d367d` passes the occurrence-aware accepted-upstream health check: 118 inherited findings, zero unallowed findings. The consolidated Python rerun is green.
- Hosted checks are running on PR #14, CI run `39750359443`; Windows/Linux results are pending. Release packaging has not been validated or published by this operation.
- Compression/restart native scenario now passes (1.4 minutes), including context shrinkage, retained UI scrollback, fresh credential binding, account isolation and ledger continuity. The shared compression-row publisher now carries only the existing nonsecret managed identity fields on continuations; it never carries credentials.

This report must be updated with the final revision and remaining acceptance results before declaring the upgrade complete.

## Native fixture reproduction boundaries

The native check uses a real development Electron app, real Python canonical gateway, real local Aino-API Go service and disposable database, with a deterministic loopback inference provider. It makes no paid model requests. The disposable PM interpreter includes only the fixture network guard in a site-packages `.pth`; production Python path scrubbing remains enabled.

The API fixture was copied from local Aino-API `81119efd596d77825a3a0df39944137419a4b8dd`, including its pre-existing uncommitted usage changes. Those source changes and the exact SHA are captured in each private fixture receipt; the original checkout was not edited. Two isolated fixture adaptations are required for reproducibility:

- The upstream agent normalizes repeated tool call IDs. The protocol fixture now checks a nonempty tool result ID matched to the immediately preceding assistant tool call, plus the exact tool name, path and returned content; it no longer compares against a globally fixed literal ID.
- The website login's external decorative CloudFront image is replaced in the copied static bundle with a local empty SVG. All external transport remains blocked. This verifies wallet/account behavior, not the external decoration or production website deployment.

The generic hosted Desktop E2E glob already included these cross-repository cases before this upgrade, but does not provision Aino-API. The upstream orchestrator explicitly disables that generic flaky lane (`if: false`); this upgrade preserves that decision and records local native coverage separately. Hosted core/update lanes remain enabled by their existing dispatch/release policy. Local native evidence does not establish that the external integration cases can run in the generic hosted job.

Pre-commit health triage compared every finding against both integration parents: 118 versus Aino HEAD and 232 versus upstream, with zero shared `(path, rule, scope)` keys. This triage is provisional; the occurrence-aware accepted-upstream check must still pass on the committed merge.

A secondary actionlint v1.7.12 audit flags the pre-existing `cache-mode` job fields, intentional disabled generic E2E lane, and duplicate ARM SDK matrix entry. These are not new runner-adaptation findings; the remote GitHub workflow parser and actual job outcomes remain part of acceptance. The cache trust policy was not removed to silence this audit.

The first hosted plugin-catalog gate caught five missing trailing blank lines in three upstream YAML files. The files now match the exact reviewed release byte-for-byte; no guard logic changed. The EOF whitespace warning is intentionally retained to preserve that provenance. Catalog structural validation accepts 761 entries; focused local tests pass 14 with 35 Linux-only skips.

The compressed managed-session cold-resume regression was proven red on the prior implementation (`KeyError: model_source`) and green after extending the shared safe metadata carry list. Both native scenarios now pass without modifying account ownership checks, cached-prefix handling, or the production tool-ID sanitizer.
