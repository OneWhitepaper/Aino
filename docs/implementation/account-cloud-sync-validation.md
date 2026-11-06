# Account cloud sync validation

This record covers isolated development fixtures. It does not establish a
production deployment or a published desktop release.

## Scope and branches

Both repositories use `codex/account-cloud-sync`. Desktop starts from
`00412c72301bb89814e9b172302fe9516d1f0f55` and depends on Agent Hub PR #32.
API starts from `0ffa72a88573916ee72525a0b7291b4085389c94`.
See [the design](../aino-platform/cloud-sync-design.md),
[adapter contract](../aino-platform/cloud-sync-local-contract.md), and
[rollout order](../aino-platform/cloud-sync-rollout.md).

## Real transport integration

The API's `TestDesktopSyncNativeConsumer` fixture creates synthetic users in real
PostgreSQL, serves the JWT-protected profile and sync routes, and invokes the
bundled desktop consumer. The consumer runs the production native coordinator,
HTTP client and real Python adapter against independent temporary homes.

At desktop `cbd8d17edf5d8c93503849869055985075420c28` and API
`cdb6b83505b92c60783cc1d7b60873d0ede45d01`, the fixture passed with:

- Two continued messages received by the original home.
- One preserved conflict copy after divergent local edits.
- A restored 68-byte PNG with a content-derived display extension.
- An empty history for a separate authenticated account.
- Durable retry after the server accepted a request but its response was lost.
- Offline local writes surviving a coordinator restart.

This transport fixture appends continuation messages through `SessionDB`.
Gateway execution and context rehydration require separate runtime tests; storage
round trips alone are not evidence of a successful model turn.

The transport fixture passed again after the local recovery fixes with API
`20d0f0f8b036bc6422f416ad799e36503994d449` and the adapter sources committed as
`53bd9aec4a03f67bddc6b3863c4d9ec5426e4608`. The same four output counts were
confirmed against PostgreSQL 18.1 and Redis.

To reproduce, bundle the consumer from the desktop repository:

```sh
node_modules/.bin/esbuild apps/desktop/electron/cloud-sync-consumer.ts \
  --bundle --platform=node --format=esm \
  --outfile="${TMPDIR%/}/aino-cloud-sync-consumer.mjs" --external:electron
```

Then, from API `backend/`, with Docker available and the fixture's environment
variables set to local executable/source paths:

```sh
CI=true go test -tags='integration nativeconsumer' ./internal/repository \
  -run '^TestDesktopSyncNativeConsumer$' -count=1 -v
```

Required variables are `AINO_SYNC_CONSUMER_NODE`, `AINO_SYNC_CONSUMER_SCRIPT`,
`AINO_SYNC_DESKTOP_ROOT`, and `AINO_SYNC_PYTHON`. Fixture credentials pass only
through private stdin; logs contain counts rather than tokens or message bodies.

## Component validation

The initial desktop implementation passed 92 focused Python tests, two real
legacy resume tests, 22 existing managed binding/status tests, all 14 repository
checks, 73 focused native/renderer tests, and 179 existing renderer regressions.
All three desktop TypeScript projects and targeted ESLint passed. Python tests
use `scripts/run_tests.sh` with a prepared isolated test environment.

The API implementation passed focused service/handler/route checks and real
PostgreSQL/Redis desktop integration tests. Numeric payload limits are enforced
against PostgreSQL's normalized JSON representation, including expanded
exponents. No claim is made that every API service test ran locally.

## Runtime continuation and fault recovery

At desktop `53bd9aec4a`, `tests/gateway/test_cloud_sync_canonical_resume.py`
passed all three cases on macOS. These start the real canonical daemon, obtain
a native ticket, and call `session.resume` and `prompt.submit` over the actual
`hermes-gateway-v1` transport. The only model endpoint is a loopback fixture.

- A cold imported conversation is adopted by the new owner and included in the
  next model request.
- A warm ordinary conversation and a warm isolated worker both receive a remote
  replacement with an unchanged message count. The next model request contains
  the replacement and excludes the old response; the new reply is persisted.

No canonical gateway production change was required: the ordinary turn path and
isolated worker already reload stored history before inference. The legacy TUI
path has its own cloud generation reconciliation.

The local remediation suite passed 54 tests before the additional cold-import
case; the final canonical file then passed 3/3. Fault regressions cover bounded
change cursors with newer receipts, preservation of device-local session fields,
owned attachment containment, and interrupted immutable-media publication.

At desktop `71782d2d11`, 128 native/renderer regression tests passed, including
two new tests for retrying failed history reads and keeping newer invalidations
when an older read rejects. Busy sessions still defer refresh. Renderer types,
targeted lint and code-health checks passed. These tests were demonstrated to
fail before their respective fixes.

API `20d0f0f8b` also passed focused decompression/upstream/sync tests, a full Go
build, module verification and a vulnerability check with zero reachable
vulnerabilities after two compression dependency updates. Both CI backend
security jobs passed for that revision.

The final combined desktop tree, including these fixes and documentation,
passed all 14 `python scripts/check` checks with zero code-health blockers or
advisories; `git diff --check` also passed.

## Release boundary

No production migration, real-account history upload, model charge, installer
publication, or merge is part of this validation. A pilot must separately verify
the deployed migration and endpoints, installed runtime packaging, and the actual
account/device rollout before release expansion.

## Final integration repairs (2026-11-06)

`tests/gateway/test_cloud_sync_compression.py` now exercises actual canonical
creation on A, adoption and continuation on B, `session.mutate(compress)` on B,
and import back to A. Both an ordinary advance and divergent A/B compression
pass warm resume/submission and another resume/submission after A's daemon
restarts. Conversations have a title; A retains its own policy and identity,
and the divergent local transcript remains a conflict copy. The loopback model
request after restart includes B's post-compression turn. Portable source labels
come from the existing local creation policy, not the gateway's live `local`
transport label. Receipt/routing reconciliation remains under existing idle and
lineage guards.

The real PostgreSQL/native/Python consumer additionally exercises a persisted
three-operation preparation against three current documents of approximately
6 MiB each. Each document has two compression segments below the ordinary 5 MiB
per-session import limit. The combined conflict receipts exceed 16 MiB. The
fixture drops the first typed size-error response, restarts after the durable
split, and restarts again after applying a page that includes another operation
still waiting in the local outbox. All three offline edits survive exactly once;
the original operation IDs replay identical receipts, and an unrelated later
conversation uploads successfully. This is real transport/database evidence,
using synthetic accounts and isolated local homes.

After these repairs, the targeted Python suite passed **68 tests in 11 files**,
including the five canonical continuation cases and existing lineage refusal
contracts. Native coordinator/private-pipe tests passed **8 tests in 3 files**.
The real consumer reported `recovered_operations=3`, continued messages `2`,
conflict copies `1`, attachment bytes `68`, and account isolation `true`.
Focused API service/handler/route/migration tests and the broader desktop and
diagnostic PostgreSQL integration tests passed. Electron TypeScript, targeted
ESLint, all 14 repository checks, and Go lint passed. The release boundaries
above remain unchanged.

The reset-boundary continuation adds two native canonical cases in
`tests/gateway/test_cloud_sync_reset.py`. A performs a real `session.mutate(reset)`;
B continues and compresses either the post-reset group or the older group. Sync
back to A completes while preserving the original logical owner, local reset
edge/metadata/timestamp, and the later reset target when applicable. A resumes
and submits both warm and after a daemon restart; model context remains on the
correct side of `/new`. Both cases failed on the preceding implementation and
passed after local reset-boundary reconciliation. The existing compression,
rebatching and execution-guard tests remain part of the affected regression run.
The reset follow-up's affected suite passed **71 tests across 13 files**, with one
Linux-only daemon test skipped on macOS; both new reset cases ran. All 14 repository
checks passed with zero code-health blockers or advisories.

## Full-suite CI follow-up

The first complete desktop CI run identified legacy fake-database tests that did
not implement the new import-generation reader, a raw profile-metadata read, and
an outdated generated locale key list. Fake-storage unit tests now isolate the
no-import seam; the real database/cloud tests remain active. The full local TUI
directory passed 3,134 tests, and the exact 17 large-server CI failures passed
after focused thread isolation. The affected five-file suite passed 650 tests.

Profile title restoration now uses the existing explicit-file backend reader,
removing a dependency on unavailable PyYAML. Its regression verifies preserved
profile/UI metadata, local configuration and secrets; the focused profile suite
passed 136 tests. The locale key list was regenerated with the existing command,
and its two checks passed. These results establish the local repairs; the final
cloud CI run is reported in the pull request.
