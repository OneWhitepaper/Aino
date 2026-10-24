# Aino private desktop diagnostics

Date: 2026-10-24. Branch: `codex/aino-private-diagnostics`. This is an implementation and local-verification record, not a production deployment or installer release.

## User-visible behavior

The existing error-card action opens the existing consent dialog. Opening it uploads nothing. Each Upload click authorizes one attempt to the signed-in Aino account service. The dialog identifies Aino as recipient, warns that conversations, tool output and file paths may remain after secret redaction, and discloses administrator access, expiry and backup retention. Success returns a copyable diagnostic ID for Aino support, never a public log URL.

The desktop has no fallback to Nous, paste sites or other upload services. A signed-out account, older runtime lacking the collector, invalid bundle, redirect or network failure produces an error. The local-only recovery command is `hermes debug share --local`. Closing during collection prevents upload; closing after the network request started dismisses the dialog but does not promise to cancel an accepted upload. A late response cannot replace a newer dialog.

## Reused boundaries

1. `hermes_cli/debug_client_bundle.py` extracts the existing client-label and redaction preparation from the legacy handler. It calls the existing `collect_share_bundle(redact=True)` and `build_nous_bundle`; the compatibility envelope stays `hermes-debug-share/1`.
2. `gateway/session_diagnostics.py` implements collect-only `diagnostics.collect` on the canonical authority transport. A verified `session:operator` grant and matching owning profile are required. The authority binds profile scope before collection moves to a thread. The standalone transport uses the existing profile decorator and RPC worker pool, so collection does not block the request reader.
3. The renderer captures the existing Aino account/generation scope before collection. Electron validates the bounded envelope and reuses PlatformAuth, PlatformClient and trusted main-frame IPC. Account credentials never enter the renderer or gateway. Account changes are rejected; uploads are not automatically retried, and redirects are refused. The existing request helper allows 120 seconds for the larger upload; ordinary account requests retain their 10-second default.
4. Aino-API reuses its JWT/admin middleware, PostgreSQL connection, migration runner, audit log and TimingWheelService. Its admin page reuses the existing table, modal and navigation. Log content is rendered as text, with stale requests aborted when closing or navigating.

The explicitly named legacy `diagnostics.share_nous` and CLI `--nous` behavior remain available. Collect-only RPC performs no outbound upload. Neither this feature nor its verification changes model prompts, conversation behavior, runtime identity or daily profiles.

## Service contract and retention

| Boundary | Behavior |
| --- | --- |
| Upload | `POST /api/v1/desktop/diagnostics`; authenticated owner comes from JWT, never request JSON |
| Owner receipt/delete | `GET` / `DELETE /api/v1/desktop/diagnostics/:id`; another account is refused; receipt excludes log text |
| Administrator | Existing admin group: list, exact-ID lookup, read and delete under `/api/v1/admin/diagnostics` |
| Audit | Admin detail reads and deletes use the existing audit middleware; log response text is not copied into audit entries |
| Size | At most 8 MiB gzip / 16 MiB expanded JSON; server validates format, timestamp, labels and redaction assertion |
| Quota | Five accepted uploads per account per rolling 24 hours, serialized by the existing user row lock |
| Storage | Migration `247_private_desktop_diagnostics.sql`: private PostgreSQL BYTEA, no static mapping, CDN or public object URL |
| Deletion | Erases bundle bytes immediately; retains receipt metadata until expiry so deletion cannot reset quota |
| Expiry | Inaccessible after 14 days; startup and hourly purge remove expired rows from the online database |

The redaction marker is a required client assertion, not proof that a log is non-sensitive. Private access remains necessary. Database/WAL snapshots and backups follow the deployment's retention policy; deleting an online row does not erase an existing backup. Purge failures use the existing service log and need normal operational attention.

## Local verification

- Python: seven affected files, **87 passed, zero failed**, including generated wire contracts, canonical operator/profile checks, actual temporary-log collection and no outbound socket. The standalone wrong-profile read was reproduced red, fixed with the existing scope decorator, then passed. Both legacy diagnostic paths were reproduced blocking the RPC reader, moved to its existing worker pool, then passed.
- Desktop: **30 files / 223 passed**, including trusted IPC, account-generation fencing, configured Aino origin/auth, redirect refusal, envelope limits, explicit consent, collection dismissal and late-result handling. The slow-upload test failed at the ordinary 10-second deadline before the fix, then proved that upload survives that deadline and still aborts at 120 seconds. TypeScript, changed-file ESLint and production build pass. Final verification commands are recorded in the implementation plan.
- API: the complete `go test -tags=unit ./...` run passed. Added expiry lifecycle and audit-response omission tests also pass with `-race`. Real temporary PostgreSQL/Redis integration verifies JWT/owner/admin boundaries, eight concurrent uploads accepting exactly five, payload erasure, expiry and physical row purge. No skip was counted as integration proof.
- API frontend: five targeted/locale tests, typecheck, changed-file lint and production build pass. Actual built admin UI was exercised at 1280x900 and 390x844 using synthetic responses: list, View and Close work; no blank page or framework overlay. An initial announcement-response mock had the wrong shape; it was corrected in the temporary fixture, with no new console errors after reload. Earlier console entries were not presented as production failures.
- Go lint: pinned 2.13 cannot read this host Go toolchain's export-data version; compatible 2.15 reports zero new issues against `d24c2f5ac`. Repository pins were not changed to hide the mismatch.

Independent reviewer dispatch delivered an empty task payload and produced no review. It is not counted as independent approval. The implementation was reviewed in the parent and checked against the behavioral tests. No paid model call or real user-log upload was performed. Native Windows/Linux UI and a real production upload are not certified by these local checks.

## Rollout order

Deploy the matching Aino-API service and migration first, including the built admin frontend. Confirm admin authentication, the reverse proxy's upload limit (JSON/base64 needs about 11.2 MB), private database access, hourly cleanup logs and the deployment's backup-retention disclosure. Use a synthetic bundle for this check. No new secret, environment setting, scheduler or cloud bucket is required.

Only then distribute the matching desktop and runtime. An older API returns an upload error without redirecting data elsewhere; an older runtime needs updating. A source commit or merge does not update installed packages. Rolling the API back must preserve the table and a functioning expiry purge for already accepted bundles; do not silently abandon retained data. Production rollout, package publication and live-log testing remain separate operations.
