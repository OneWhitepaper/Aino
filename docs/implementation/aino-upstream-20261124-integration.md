# Aino full upstream integration — 2026-11-24

## Scope and immutable inputs

- Aino base: `0aa0ddf65071d09cc7aacb9c73e046ecdf26fa20`.
- Previous upstream ancestor: `ae2a81ccc00e9b7c06301523e5bb09608397149c`.
- Stable checkpoint: `caafe5389ae585ef77387a962aee05b1bcf17029` (v0.23.3).
- Complete requested target: `352b249f67fb6a4a7d7904acaca9dd410db229e0`.

This task imports the entire frozen upstream main snapshot, not just selected
v0.23.3 changes. Aino's current UI and account/model/billing/Work-Code boundaries
remain authoritative. No installer publication, update-feed mutation, source
push or production service change is included.

## Compatibility ownership

- Preserve the current activity rail, navigation, chat measures, typography,
  colors, Summary and tool panels. New upstream behavior uses existing owners
  and UI primitives rather than a replacement shell.
- Move storage consumers to the upstream persistence contracts, preserving
  account ownership, executable history, Code thread/work-file continuation
  and compression metadata. Retired automatic cloud history sync stays retired.
- Keep selected-model/credential/billing authority for every foreground and
  auxiliary call, including cache warming, and retain uncertain-outcome
  non-replay guards.
- Keep Aino native updater identity, opt-in Intel support and Windows ZIP
  semantics while adopting upstream build/provenance protections.
- Preserve strict catalog scanners, source pins, metrics consent and protected
  filesystem/browser boundaries.

## Validation record

This section records completed checks and explicitly identifies the remaining
platform gates; it is not a whole-suite green claim.

- Before import, 76 Python cases passed across Codex Responses adaptation and
  executable desktop history recovery through `scripts/run_tests.sh`.
- Before import, 13 Electron legacy-history/updater cases passed.
- The exact pinned pnpm frozen install passed for all eight workspaces.
- Catalog structural validation passed all 2,575 files; existing warnings were
  retained, not suppressed. Pinned-source validation is a separate gate.
- The combined pnpm dependency hash was computed by the actual fixed-output
  builder in native ARM64 Linux using an isolated Nix container. Its reported
  content hash is `sha256-EWVC1v1pcAEANrF1fLuC4uWVeKimQakNqAY1n/cYhZo=`;
  neither conflicting pre-import hash was reused. This is not a claim that the
  whole Nix package matrix has passed.
- Upstream commit `707cf0fde0` explains deletion of `fixture/SOUL.md` and
  `owned/SOUL.md`: they were accidentally committed test-home artifacts. Their
  deletion is retained; no actual user home is removed.
- The four changed built-in handbook source chapters are refreshed without
  losing their Aino applicability headers. A new local chapter documents the
  imported runtime capabilities and their account/security boundaries.
- After import, 64 documentation/product-help tests passed through the isolated
  Python runner. Both prompt-surface invariants passed without regenerating or
  weakening the stock prompt/tool snapshot. Plugin boundary lint passed with
  its existing baseline (817 module-to-core and 20 core-to-module crossings).
- The existing TUI and web consumers of shared contracts both typechecked;
  this is compatibility evidence, not a new web/CLI product or a native desktop
  acceptance result.
- Public plugin API documentation and the serve-handler ledger/programmatic
  method listing were regenerated with the existing generators and their
  `--check` modes passed. Desktop schema generation remains separately owned
  by its existing generator.
- All 25 handbook source-hash receipts match their current sources. The 12
  workspace manifests, lock/tool pins and Nix dependency-builder inputs still
  match the source snapshot used to calculate the dependency hash.

### Resolved integration defects

- Decoded the provider-exact `api_content` sidecar at the shared storage export
  boundary. Export/import no longer double-encodes it or loses image parts.
  The new nine-case behavior contract was independently rerun: nine passed.
- Moved Aino's compaction display/replay rules to `session_rules.turns`, the
  lower owner now used by storage. Its prior-human corroboration callback and
  recorded replay metadata keep synthetic restatements out of the transcript
  without deleting human quotes or multimodal content. Three new contracts
  failed before the fix and passed afterward; both existing compacted-tool
  paging regressions also passed after the fix.
- Scoped planned backend transitions by connection as well as profile. A local
  `default` transition cannot disable an unrelated remote `default` composer.
- Connected bounded planned-restart recovery to exact-owner session requests,
  preserving their captured route and rejecting superseded/uncertain writes.
  Both desktop defects were independently rechecked with fresh isolated probes.
- Removed retired root storage internals instead of restoring compatibility
  shims. Aino consumers use upstream typed persistence repositories; only the
  four official upstream root facades remain.
- Preserved pivot-row identity and native multimodal replay in the new lower
  turn-repair owner. Four new contracts failed before the missing Aino guards
  were moved, then passed; the existing Ultra image/policy/prefix and TUI
  row-addressing regressions also passed. An unfiltered five-file convergence
  run completed with 658 passed and zero failed, including all 616 TUI-server
  cases. The Ultra fixture now supplies the typed repository's explicit
  destructive replacement mode, matching its former replacement operation.
- Fixed the registered, rebound model-switch writer's missing class lookup;
  the necessary import now executes in the invocation's local namespace.
  Independent real-store, canonical binding and compression/cold-resume checks
  completed with 13 passed and zero failed. No marker, lineage, model-route or
  credential assertions were removed.
- Kept explicit commit identity when code-health judges a detached candidate.
  Converting a commit to its tree had discarded the ancestry required by the
  existing first-import classifier. Its severities, caps, occurrence matching,
  ancestry requirements and waiver expiry are unchanged. Independent focused
  checks passed 123 cases, with three additional adversarial identity probes.

### Existing Aino UI remains the authority

`9dc5ae6d46` intentionally replaced the old workspace controls with Bot
management. The integration does not put the upstream profile rail back into
Settings or replace Manage Bots. Native compatibility journeys use the existing
`/profile <name>` composer action and owner-routed window/session entries.
Persisted `profile.get()` and the host-registry `/api/profiles/active` endpoint
are not accepted as proof of a renderer session's execution owner. The managed
journey additionally checks its actual billed session in the named profile's
durable store and its absence from the default store.

### Broad-suite checkpoints (not final acceptance)

| Scope | Completed evidence |
|---|---|
| Python build/CI/scripts | 3,139 passed, two HEAD/index-dependent failures, 387 host skips; rerun after the real merge is recorded |
| Root JavaScript | 437 passed, five host skips |
| Packaging JavaScript | 311 passed, 17 host skips |
| Catalog confinement/provenance | 22 passed, 38 Linux-only host skips |
| Full storage | 2,695 passed, 69 failed, 89 skipped across 368 files; explicitly not green |
| Renderer, third run | 17,883 passed across 2,118 files, zero failed; immutable renderer/shared-source receipt |
| Electron, third run | 4,881 passed, 76 host skips, zero failed across 525 files; unchanged test budgets, one worker |
| Native initial account isolation | Both legacy and canonical A → B → A variants passed; canonical case checks actual gateway PID/home |
| Runtime convergence after lower repair | 658 passed, zero failed across five complete files; includes 616 TUI-server cases |
| Generated contracts, prompt and docs | Ten passed across five files; four generator freshness checks and plugin boundary lint also passed |

Independent comparison reproduced all 67 remaining original storage failures
on both the frozen upstream and the task snapshot: one lost-and-found metadata
parity mismatch and all 66 exact holder-admission node IDs across 20 files.
There were no missing cases, extra cases, skips or timeouts in that comparison.
Holder failures arise when the test real-home I/O guard blocks psutil's
enumeration of unrelated processes, so upstream fails closed. The two actual
merge regressions in compacted-tool paging passed after the lower projection
fix. This does not turn the original 69-failure run green or justify bypassing
admission, stopping real user services or weakening the test fence.

Three old Aino refusal cases for writer-shaped empty model receipts now test
complete receipt identity on restoration. Upstream `0579addc71` intentionally
accepts these receipts; malformed types, whitespace models, configuration,
request JSON and route fields still refuse. Together with the upstream restore
roundtrip and typed web search/event-loop contracts, 33 tests passed in the
four-file controller check.

### Conflicted catalog pins

The exact frozen upstream validator ran in a disposable Linux container against
clean public source, without mounting personal homes, credentials, Git history
or the Docker socket. All three entries below passed dependency installation,
manifest/capability checks, the unchanged security scanner, confinement,
self-updater and executable-payload gates. Injection Shield additionally passed
the desktop SDK surface check. Every security scan reported `safe`.

| Entry | Version | Exact pin |
|---|---|---|
| Nexus | 0.22.65 | `526ef84dc163d074bcbe9bd670ceaa8b2f7952db` |
| Scope Recall | 4.0.4 | `6c49a94cb08f63fc89cc46b17faf6aa5c02ea235` |
| Injection Shield | 0.9.1 | `50ef097e2be73aeb6d923595562bb0bb3819f57f` |

The new reachable Scope Recall source and repaired Injection Shield revision
can therefore return to discovery. Earlier exclusions whose upstream pins did
not change remain excluded. Existing installed plugins were not touched.
The final reviewed catalog tree is
`d41911abb8ea97eb927c6b0824eb3c61f7ad476b`. The seven admission enforcement
inputs remain byte-identical to the frozen upstream snapshot. This local
three-pin validation does not claim that every changed catalog entry or the
whole external CI matrix has been executed locally.

### Integration check history

The first full `scripts/check` ran 22 checks. Its case-collision failure was an
unresolved index, backend-import failures were repaired at the storage boundary,
and its health findings still require exact ancestry-aware classification, not
a blanket exemption. A fresh immutable two-parent validation candidate,
`9e34799923dee2d9436f53cbc486d47bfbbc0820` (tree
`a658c841da198b9715b15209650e8ce9ad4dbc98`), passed all 21 non-health checks.
Its separate ancestry-aware health scan completed with eight blocking
findings: three function-complexity increments in the runtime/desktop, one
additional desktop function, two file-size increases and two shadowed fixture
definitions. Narrow owner refactors fixed all eight without cap, severity or
waiver changes. A second snapshot caught a missing `json` import in a moved
test; that test-only defect and six stale image-persistence fixtures were
repaired, with 419 cases passing across 16 complete files. The second scan is
retained as failed evidence, not relabeled green. The final staged snapshot's
whole-tree scan is a separate gate below.

The original whole-import whitespace check also reports three trailing blank
lines whose blobs are byte-identical to the frozen upstream: the two catalog
entries `laso-finance.yaml` / `stoa.yaml` and the launchd migration test. The
reviewed catalog tree is not silently changed to hide that inherited formatting.
New authority modules' trailing blank lines were removed.

### Final native desktop checkpoint

The final desktop build and dev Electron bundle both completed successfully.
All 1,139 active `dist` files exactly match artifact 7, SHA-256
`b71e5eb3a25d49aec24d6206064c52a59ce5821267f649d7b73091eb0c609aaa`.
Pre/post build source and production hashes match; the complete desktop
typecheck (renderer, Electron, E2E and builder config) passed again after the
controller fixture changes. Latest affected renderer checks passed 104 cases
in 12 files; affected Electron contracts passed 47 in four files. The earlier
whole renderer/Electron runs above predate these last small fixes and are not
misrepresented as full reruns of artifact 7.

The existing Playwright Electron workflow, isolated fixture accounts/homes and
loopback-only model/API services were used; no real user credentials, balance,
history, installed application or public update feed was changed. Native
journeys ran serially on macOS Apple Silicon with original deadlines.

| Final exercised journey | Result |
|---|---|
| Account A → B → A, legacy isolated backend | Passed, 30.3 s; history, account home, renderer and Chromium isolation assertions retained |
| Account A → B → A, managed canonical gateway | Passed, 35.3 s; same isolation plus actual gateway owner PID/home |
| Managed Bot/workspace switch, tool turn, peer window and hide/show | Passed, 29.3 s after strengthening the negative proof; two usage calls, one tool result, exact wallet/ledger equality, zero orders and secret/network audits |
| Pre-cutover Desktop/TUI histories across default and named profiles | Passed, 14.4 s; all four listed/opened, all-profile views and owner-scoped mutations, zero resume failures |
| Real pinned Codex Work/project Code/projectless Code recovery | Three passed, zero skips, 47.4 s after final runtime refactors; sync → send → restart → send |
| Original active/archived Code thread resume | Two passed, zero skips; exact pinned Codex binary and offline provider fixture |

The silent `/profile` feedback regression was traced to automatic Work/Code
draft restoration revoking its own pending selection. The existing
`preserveProfileSwitch` option now preserves only that same automatic intent;
new explicit drafts, mode/account changes and activation errors keep their
existing cancellation/failure behavior. New mounted lifecycle tests reproduced
the defect before the fix; the real native journey now observes its success
notification and completes the actual owner-routed turn.

Billing session IDs are correlation UUIDs, not raw transcript IDs. The native
proof resolves the exact typed creation receipt and physical transcript using
the existing canonical billing derivation, then requires both the actual human
prompt and verified assistant response in exactly one named-profile binding
and none in the default store. It does not substitute a remembered profile or
host-level active-profile setting for execution evidence. Task-owned canonical
gateways are stopped before deleting fixture homes; the final process audit
found no surviving task gateway and stopped no user service.

Final review caught a tests-only blind spot in the first negative proof:
filtering default rows by a named-profile billing UUID could never detect a
second write under the default profile's different UUID. The native and offline
checks now call one shared real-store fixture helper. It scans default exports
independently of correlation or binding, including hidden/archived, compacted
and inactive messages, while retaining the named receipt/current-target proof.
Six negative cases failed before the fix; all eight final cases passed,
covering bound/unbound duplicate user-only, assistant-only or complete turns,
the clean positive and a wrong billing ID. The unchanged artifact 7 native
journey passed again with that stronger check (29.6 s total).

Both independent runtime/desktop P2 findings were closed on the repaired
sources. The reviewer separately reran the lower turn guards, mounted plugin
recovery and slash/workspace lifecycle contracts. All eight bounded health
repairs were independently reviewed, with 251 Python and 47 JavaScript cases
passing in the enumerated review selections and no assertion removals. The
final tests-only negative-proof P2 was also closed after an independent fresh
eight-case real-store run; no production defect was inferred from that proof
gap. The whole-tree health result is recorded below.

### Final staged acceptance

- All 224 original conflict paths are resolved in the actual index; no
  conflict stages or executable conflict markers remain.
- Validation candidate `0e2c2d3f24518c4b130b659f70dc3bc7911d610e`, tree
  `d7aa4c1955d80fe5efadb70e71965a4e0cdba35e`, has the real Aino base and
  frozen upstream as its two parents. Its ancestry-aware whole-tree health
  scan exited zero: 94 reported findings, zero unallowed blocking findings;
  87 retain their existing explanatory comment allowances and seven are
  occurrence-matched inherited upstream debt. No threshold or policy changed.
- All 21 other checks passed against the actual final staged index. Compared
  with the scanned candidate, the later changes are this integration record
  and the tests-only negative-proof fix above. Candidate
  `71dce6ab4c2c72b1cd1363bfec3389e06a7f2d8a` was checked against that full
  scanned baseline without an inherited allowance: zero new health findings,
  exit zero; application/runtime production blobs remain identical. Generator,
  schema, prompt and documentation freshness passed again (ten cases), as did
  the existing plugin boundary lint. All 25 handbook receipts still match.
- Independent bounded final review is closed with no remaining actionable
  finding.

### Local merge and post-commit verification

The real merge is `4f181f630fa6b9089507508a06dd302d09038712` on
`codex/aino-upstream-20261124`, with parents
`0aa0ddf65071d09cc7aacb9c73e046ecdf26fa20` and
`352b249f67fb6a4a7d7904acaca9dd410db229e0`. Normal pre-commit hooks ran
successfully; no hook was bypassed. Existing nonblocking ESLint warnings were
reported, not silently fixed or reclassified. Shared `main` was already an
ancestor of the Aino input and was not moved.

After that commit, the canonical Python runner executed the complete
case-collision and commit-release-pipeline files plus the shared storage-proof
regressions: 21 passed, zero failed, one Linux-specific skip across three files.
This supersedes the two earlier HEAD/index-dependent failures in the broad
checkpoint, not the entire earlier suite. All 21 non-health checks passed again
against the real merge commit. Health comparison from the fully scanned source
candidate to that commit exited zero with an empty findings list; only the
three tests/fixture paths and this evidence record differ, with no production
or health-policy changes. This is a delta check, not another whole-tree scan.

The merge was clean before this documentation-only evidence update. No push,
shared-main update, installer publication or live-service change was made.

The whole Python suite is not claimed green: the 67 inherited storage failures
above remain documented and reproduced, not bypassed. Native Windows/Linux,
Intel macOS, all external catalog producers and the full Nix matrix still need
their own platform/CI acceptance before a release.
