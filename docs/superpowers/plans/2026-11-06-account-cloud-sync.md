# Account Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically synchronize account history across computers and permit continuation while preserving offline local work.

**Architecture:** Existing native authentication drives a scoped local Python adapter and revisioned platform storage. Durable snapshots and receipts provide retry safety; idle-guarded imports and conflict copies protect execution and offline edits.

**Tech Stack:** Electron/TypeScript, Hermes Python/SQLite, existing Go/Gin/PostgreSQL platform.

**Spec:** `docs/aino-platform/cloud-sync-design.md`

## Global Constraints

- No desktop installer is published by this work.
- Server ownership comes solely from authenticated account identity.
- Never synchronize credentials, local permissions or execution ownership.
- Never mutate a running turn or replay tools/inference during synchronization.
- Offline local changes and conflict copies survive restart.
- Use existing Hermes persistence, import validation and mutation guards.
- Python tests use `scripts/run_tests.sh`; run `python scripts/check`.
- Desktop base is `00412c7230` (depends on unmerged PR #32); API base is `0ffa72a88`.

### Task 1: Platform revisioned history and private blobs

**Files:** in Aino-API, create `backend/internal/service/desktop_sync.go`,
`backend/internal/repository/desktop_sync_repo.go`,
`backend/internal/handler/desktop_sync_handler.go`, a numbered SQL migration and
focused tests; update desktop routes and Wire provider wiring.

**Interfaces:** Implements the exact exchange/blob HTTP contract in the spec.
Consumes existing JWT subject and PostgreSQL connection. Produces deterministic
idempotent receipts, monotonically committed per-user cursors and quota errors.

- [ ] Write failing behavioral tests for owner isolation, same-op retries,
  conflicting base revisions, concurrent writes and tombstone resurrection.
  ```go
  // Store the same operation twice and assert the returned revision is unchanged.
  // Write a different payload at the original base and assert status == "conflict".
  // Read the same key as a second JWT subject and assert no document is returned.
  ```
- [ ] Implement validated DTOs/service, transactional repository, migration,
  private blob endpoints and production dependency wiring. Use locked per-user
  revision rows; persist op fingerprint and result in the same transaction.
- [ ] Exercise real PostgreSQL repository behavior using the repository's existing
  integration harness, including quota rollback and digest verification; run
  focused service/handler/routes tests and compile Wire output.
- [ ] Commit only API changes and write test evidence to the task report.

### Task 2: Local durable adapter and safe continuation

**Files:** create `hermes_cli/cloud_sync.py`, topical `hermes_cli/cloud_sync_*.py`
helpers, `hermes_state_cloud_sync.py` if a persistence sibling is needed, and
`tests/hermes_cli/test_cloud_sync*.py`; minimally extend existing portability seams.

**Interfaces:** JSON stdin/stdout adapter described in the spec. Publish exact
request/response interfaces in `docs/aino-platform/cloud-sync-local-contract.md`
before native integration. `prepare` must be repeatable; `apply` must verify a
persisted request/operation identity before accepting network results.

- [ ] Build a real-SessionDB two-home test before implementation:
  ```python
  # A persists a conversation, prepare creates a stable outbox operation.
  # Applying the accepted record on B restores messages and continuation context.
  # B appends a new user/assistant turn; syncing it back leaves A with both turns.
  # Repeating apply has no additional effect and runs no tools/model requests.
  ```
- [ ] Implement canonical portable snapshots, durable outbox/cursor/receipts,
  idle-guarded incremental import, deterministic conflict identity remapping,
  local deletion discovery and tombstone application.
- [ ] Add safe owned-profile and media portability; test escaping symlinks,
  missing/oversized files, archived flags, compression lineage and bot identity.
- [ ] Test restart with pending operations, lost response, concurrent edits,
  remote deletion with offline edits, busy/unknown execution and no credential
  inclusion. Run focused tests via `scripts/run_tests.sh`, then commit and report.

### Task 3: Native coordinator and visible synchronization state

**Files:** create `apps/desktop/electron/account-cloud-sync.ts` and focused tests,
`apps/desktop/shared/platform-sync-contract.ts`; extend `platform-client.ts`,
`platform-auth.ts`, native lifecycle/preload typed bridge, and a feature-owned
renderer status store/view with translations and tests.

**Interfaces:** Consumes Task 1 HTTP and Task 2 local JSON contracts. Network calls
run through native auth with expected account/generation; only status and changed
session IDs reach renderer. Child launch resolves the actual installed runtime.

- [ ] Write coordinator tests using deferred network promises:
  ```ts
  // Begin A's exchange, switch to B, resolve A: no apply or B status publication.
  // Fail network after prepare, restart coordinator: same operation is retried.
  // Tick twice while one request is pending: only one exchange is in flight.
  ```
- [ ] Wire bounded native local adapter calls, blob transport, exchange, periodic
  polling, cancellation/draining, retry and workspace lifecycle readiness.
- [ ] Publish honest sync status and refresh local sidebar/transcript caches
  without navigation or interrupting active streams. Add all supported locales.
- [ ] Run focused Vitest, TypeScript/build checks, plus two-home/API integration
  with the real Python adapter. Commit and report exact evidence.

### Task 4: Integration acceptance and delivery

**Files:** update the design/local contract and acceptance evidence under
`docs/implementation/`; repair only failures found by integration/review.

- [ ] Review each component's spec compliance and code quality using a fresh
  reviewer and a saved diff package; resolve Important/Critical findings.
- [ ] Prove A→B continuation→A, offline/restart/retry, attachments, bot history,
  no cross-account access, conflict preservation and busy-turn deferral together.
- [ ] Run required repository checks and final review. Record any genuine
  environment limitations without claiming unperformed checks succeeded.
- [ ] Prepare reviewable branches/PRs with explicit PR #32 dependency and migration
  rollout notes. Do not deploy production or publish an installer in this task.
