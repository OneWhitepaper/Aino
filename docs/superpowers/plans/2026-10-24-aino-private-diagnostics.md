# Aino private diagnostics implementation plan

**Goal:** Route the existing consent-gated desktop diagnostic upload to Aino, with private administrator access and deletion after 14 days.

**Architecture:** Reuse Hermes collection, redaction and gzip envelope. An operator-authorized, profile-scoped, collect-only RPC returns the bundle; Electron reuses PlatformAuth and PlatformClient to upload it to Aino-API. The API uses its existing JWT/admin middleware, PostgreSQL connection, migration runner and timing wheel. No third-party fallback, public object URL, new auth manager or scheduler.

**Scope approved:** User approved the Aino-owned ingestion/query service, private storage, administrator view and actual retention. No production upload of real user logs is part of verification.

**Constraints:** Explicit consent for every upload; secrets remain in Electron; original CLI Nous support remains explicitly named; no prompt/model/runtime identity changes. Limits: 8 MiB compressed, 16 MiB decompressed, at most five uploads per account per day, 14-day retention, expiry enforced on reads and physical purge hourly. Database backups follow the deployment's existing backup retention and are disclosed separately.

## Tasks

- [x] Prove collect-only/profile/operator behavior with Python tests; extract the existing redacted client-bundle preparation and register `diagnostics.collect` on canonical and standalone transports. Regenerate the shared wire contract. Test with `HERMES_PYTHON=/private/tmp/aino-v0222-test-venv/bin/python scripts/run_tests.sh tests/gateway/test_session_diagnostics.py tests/tui_gateway/test_diagnostics_share_nous.py`.
- [x] Prove native authenticated upload/redirect/account-change behavior with Vitest; extend the existing platform client/auth/IPC/preload contracts. Validate the bounded gzip envelope in Electron and upload through the existing production origin. Preserve the dialog generation guard; prevent upload after dismissal during collection.
- [x] Prove API bundle validation, owner/admin authorization, quota and expiry/deletion with Go tests. Add the necessary PostgreSQL migration and repository, diagnostics service and handler sibling. Inject into the existing DesktopHandler and route groups; schedule physical deletion on the existing TimingWheelService, with shutdown cancellation.
- [x] Add a diagnostics page to Aino-API's existing admin navigation, layout, table and modal patterns. Display uploaded text as text; require existing administrator auth for every request. Update desktop consent and help copy in every supported locale.
- [x] Run Python, desktop typecheck/Vitest/lint/build, Go tests/build and API frontend typecheck/tests/build. Exercise a synthetic upload through the full authenticated API flow, without calling any model or uploading user state. Record exact evidence and deployment steps; commit both feature branches without deploying or merging.

## Verification boundaries

Opening/dismissing the modal must not upload. An unavailable collector, signed-out account, redirect, failed upload or changed account must surface an error without contacting Nous. Expired bundles are inaccessible before the periodic purge. Cleanup removes the bytes, not merely an index. Administrator detail reads are audited without copying bundle content into the audit log. The original branding commit and unrelated API usage work remain intact.

## Completion evidence

Implementation and local verification are recorded in `docs/implementation/aino-private-diagnostics.md`, with the API deployment contract in its paired repository `docs/aino-private-diagnostics.md`. Native uploads against production, native Windows/Linux UI, deployment and installer publication remain outside this local-verification checkpoint. Reviewer dispatch supplied no scope and produced no independent approval.
