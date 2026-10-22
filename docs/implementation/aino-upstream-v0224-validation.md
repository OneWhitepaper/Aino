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

## Acceptance ledger before final reply-compatibility follow-up

- Canonical native Desktop transport must preserve Aino managed model creation and credential binding. Review found the upstream create contract rejecting Aino model identity fields and its session fallback correctly refusing legacy writers; compatibility has been added through the existing owner and ManagedModelRegistry. The Electron controller now reuses native gateway ticket issuance, sends the ticket as the existing WebSocket subprotocol, and preserves the selected profile. The native fixture has passed authorization, tools, cancellation, restart, workspace switching, and custom-provider routing; the final combined rerun passed (one complete scenario, 3.4 minutes), including the independent website wallet and secret/transport audit.
- Development Electron E2E needs the PM test interpreter as `HERMES_DESKTOP_PYTHON` and `node apps/desktop/scripts/bundle-electron-main.mjs --dev` for the explicit legacy-account test adapter. A release bundle deliberately disables that adapter. Run through `scripts/run-in-hermes-env bash -c 'cd apps/desktop; export HERMES_DESKTOP_PYTHON="$__HERMES_TEST_PYTHON"; npx playwright test e2e/project-navigation.spec.ts e2e/appearance-modes-only.spec.ts e2e/chat.spec.ts --reporter=line --output="$TMPDIR/aino-v0224-project-results"'`. After the cold tile resumed its canonical cwd and the E2E waited for the restored PTY to attach, all 13 affected scenarios passed.
- Committed merge `15299d367d` passes the occurrence-aware accepted-upstream health check: 118 inherited findings, zero unallowed findings. The consolidated Python rerun is green.
- Hosted CI `39753665452` on `97e8ac8494` passed JS/TS, lint, build, macOS and Windows x64/ARM checks and three Linux Python slices. The remaining Linux slice exposed three cases of the same authorization-ordering regression described below. Independent Termux, Nix, Docker and all four PM bundle platforms passed. The plugin source gate timed out after 30 minutes without a validation finding; the next revision must complete the full gate before integration. Release installers have not been validated or published by this operation.
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

## First hosted CI repairs

- macOS slow schema reconciliation could exhaust its progress budget during `BEGIN IMMEDIATE`, outside the existing rollback/error translation block. The begin now shares that block. A deterministic real-SQLite regression fails before the fix and passes after it; the complete file passes 29 tests with one Linux-only skip.
- Termux's selected-workspace install exposed an undeclared `tests-js` dependency on `app-builder-lib` for real DMG blockmap tests. The test workspace now declares the existing pinned version, without changing production notarization. An isolated selected-workspace install reproduced 2 failures before the fix and passes all 6 notarization tests after it. Root JavaScript validation with the PM test interpreter passes all 257 tests (4 skipped), typecheck and lint.

## Follow-up acceptance repairs

- Managed credential preflight in `AuthorityConnection.submit` ran before the existing authority check. A read-only viewer, wrong-profile viewer, or stale route could therefore reach Aino policy lookup before the upstream refusal. The preflight now follows the existing authorization check, and sourceless sessions skip only the source policy lookup. The upstream principal test failed in three cases before the fix. A real managed-session regression also proves that a read-only submission without text receives `permission_denied` rather than a credential-state response. Four authority/managed-session files pass all 19 tests with retries disabled.
- The native concurrent-account check exposed a wallet alert during normal sign-out: the account generation retires before the final signed-out snapshot is broadcast. The wallet now clears retired-scope data silently for the existing named retirement errors while retaining genuine network/IPC errors. It reuses the existing error parser and billing scope/query keys. The old implementation fails four new checks; the complete seven-file billing suite passes all 28 tests. The latest Desktop typecheck, scoped ESLint, production build and all 12 `scripts/check` checks pass.
- The corrected native same-site concurrent-account scenario passes in 1.6 minutes: overlapping requests use isolated credentials, sessions and billing ledgers; switching the left account retains readable history, blocks foreign-owner sends before credential/inference access, and permits an explicit new chat. Unexpected-alert and external-transport assertions remain enabled.
- A subsequent native run stopped at login because a production build had replaced the development Electron entry. Production correctly ignores the test site's development configuration, and the fixture correctly blocks external transport. The renderer was rebuilt from the latest source and the main/preload entry rebuilt with the existing `--dev` bundler; no production routing or guard was changed to bypass that failure.
- The catalog import changes 248 entries, exceeding the small-entry-PR gate's 30-minute job limit: 224 entries completed and the 225th was active when the job was cancelled. The existing job now has 60 minutes. Each entry still uses the same pinned clone, provenance, payload scanning, validation-tree confinement and per-entry deadlines. Catalog content and enforcement inputs remain exact reviewed upstream bytes; no entry is waived.

## Canonical reply compatibility follow-up

- On `eac19ef9d639b70c556c73c7168f09fa2f9ba334`, the complete hosted CI run `39763921650` succeeded, including all four Python slices and native macOS/Windows lanes. Independent plugin-catalog `39763921380`, four-platform PM bundle `39763921427`, and Nix `39763921591` also succeeded. These receipts cover that revision; the following changes require their own final checks.
- The canonical local turn omitted the existing per-reply display metrics, so a correctly charged successful turn had no reply-cost UI. `gateway/session_usage.py` now bridges to the existing `tui_gateway.turn_metrics` and managed receipt helpers while the existing billing scope is active. Counters remain per-turn, BYOK retains its neutral source disclosure, and display persistence uses copy-on-write history. There is no new billing manager or model-prompt mutation.
- Late auxiliary receipts reuse the existing bounded original-reply writer. Their live update is scoped to the original authority/session instance and explicitly uses `execution={}`, so it cannot borrow a later admission's generation. Reopening the database and moving the physical agent to a compression tip do not redirect the receipt to the next reply.
- Live completions now retain the existing classified error descriptor, raw Details text, and partial-output flag. Aino-managed auth errors no longer advertise the underlying provider's key/OAuth editor; the existing account recovery action remains authoritative. Provider API-key and OAuth failures keep their upstream recovery actions.
- Review found that adding ordinary provider descriptors widened the pre-existing gateway-refusal writer. That writer is now confined to the existing `CRON_SESSION_READ_ONLY_SURFACE`. Four new real-settlement regressions first failed, then passed: existing partial-side-effect guidance is preserved, and overflow/deferred/exhausted compression failures do not gain an extra transcript row.
- Five metrics regressions failed before the bridge, two error-projection regressions failed before forwarding, a managed-recovery invariant failed before excluding provider-key recovery, and the partial-output regression failed before forwarding its flag. Valid red outputs are retained in the local verification logs; fixture setup errors are not counted as red evidence.
- Final consolidated Python reply/error/settlement verification passed all 154 tests across 13 files with retries disabled. Renderer reply/error/reconciliation verification passed all 57 tests across four files. E2E TypeScript checks and all 12 `scripts/check` checks passed, with zero new health blockers/advisories.
- The native offline test explicitly refreshes account, wallet, and device inventory through their respective existing recovery controls. It no longer assumes account retry erases a separately owned Devices error. Error-card probes open the existing Details disclosure and still reject unexpected alerts.
- The 503 native scenario preserves v0.22.4's bounded automatic recovery ladder. The old expectation of a terminal error within 45 seconds was invalid: the actual UI showed its recovery countdown. The updated probe restores the loopback provider during that visible wait and checks that no inference was charged while failures were injected. It does not disable the ladder or change production retry policy. The 429 path still verifies Retry-After spacing, a classified terminal card and an explicit user retry.

The final source passed native offline/revocation recovery (1.3 minutes) and late-lease account replacement with visible charge (31.1 seconds) in `/tmp/aino-v0224-lifecycle-e2e-final.log`; the separately rerun inference recovery scenario passed in 1.1 minutes in `/tmp/aino-v0224-inference-e2e-final.log`. That combined run's inference case used a cached pre-fix test module with a misspelled statistics field; the corrected test passed its TypeScript check before the separate native rerun. The final inference proof checks one classified 429 card, Retry-After spacing, explicit retry, visible bounded 503 waiting followed by automatic recovery, no-charge rejection, balance restoration and explicit resend, and unexpected-alert/transport/credential audits.

Read-only review found no remaining blockers after the refusal-writer fix. Refetch confirmed `origin/main` remains the recorded base and is an ancestor of this branch, so no newer main changes are being overwritten. Exact-final-revision hosted CI is pending at this documentation checkpoint; its final head and checks are linked by PR #14. No paid inference, installer publishing, deployment, daily-profile changes, or daily-desktop restart is part of this integration.
