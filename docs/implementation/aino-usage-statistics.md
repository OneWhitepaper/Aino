# Aino usage statistics

Aino reuses the Hermes shared-metrics collector, bounded counter schema, SQLite outbox,
daily packaging, consent windows and retry sender. It does not introduce a second collector.
The technical `hermes.shared_metrics.v4` schema and metric identifiers stay compatible.

## Consent and destination

Collection and sending are off by default. Choosing **Share with Aino** enables them for the
selected profile. The destination is `https://api.agentera.com.cn/api/v1/desktop/shared-metrics`.
The request contains a random, profile-scoped installation ID; it carries no Aino account token.
Selecting Share with Aino restores that declared destination. Configuration cannot redirect this
consent to another remote receiver; loopback overrides are reserved for isolated tests. HTTP
redirects are refused and remain pending in the existing retry queue. Each network attempt,
including a retry after backoff, rechecks the current consent; turning sharing off prevents
any later attempt. A request already in flight cannot be recalled.
This ID permits linking that profile's daily counts, so these are pseudonymous counts, not a
claim of complete anonymity. Existing network access logs follow the deployment's logging policy.

The package contains model/tool usage, token totals, timings, coarse machine facts and bounded
feature/error categories. It contains no conversation messages, files, paths, API keys or error
text. The receiving API validates the existing v4 schema, including each metric's allowed fields,
before persistence. Compressed and expanded inputs are capped at 1 MiB.

An old **Share with Nous** answer is not permission to send to Aino. Such sending remains blocked
until a new answer records `recipient: aino`. Older clients cannot grant that consent and older
backends are not offered an Aino sharing control. The old open intervals are closed and retained
for audit; they cannot qualify historical packages for Aino. Only complete daily periods inside a
new Aino interval are eligible. As in Hermes, one installation note may be counted after opting in.
Closing the details dialog does not opt in. Sharing may be turned off in Settings at any time.
The existing status/set RPCs are also adapted to the canonical desktop gateway: reads require
profile read access, changes require operator access, and the same profile-scoped consent writer
handles them. Saving an answer does not upload a package or start model inference.

## Existing management and retention

Aino-API stores validated usage packages through the existing private desktop-diagnostics service
and table. They have type **Usage statistics** and no account assignment. Manually uploaded support
logs retain type **Diagnostic logs**, their owner, separate consent, upload limit and deletion flow.
The same administrator page distinguishes both types; it does not expose a public read URL.

Administrator reads use the existing authenticated, audited routes. Access expires after 14 days,
and the existing hourly cleanup removes online records within the following hour. Existing backups
follow the deployment's backup retention policy. Deletion immediately removes payload contents;
the receipt stays until expiry to enforce limits. Retries do not recreate deleted contents.

The anonymous count-ingestion route uses the existing Redis limiter, fails closed without Redis,
and does not accept administrator or account information from the body. A package ID is idempotent;
at most 32 packages per installation are accepted in a rolling day. This permits bounded catch-up
without opening log uploads or administrator reads to unauthenticated clients.

## Integration and rollout

Deploy Aino-API migration `249_desktop_shared_metrics.sql`, the matching API and the existing admin
frontend first. The server embeds an unchanged copy of Hermes's v4 schema; synchronize that artifact
when updating the wire schema. No new scheduler, account manager, queue or cloud storage is used.
Then distribute the matching Aino runtime and desktop. An unavailable endpoint leaves packages in
the existing bounded retry queue; it never falls back to Nous or another recipient.

Implementation and local synthetic tests do not establish that production has been deployed or
that a real user's counters have been uploaded. Keep those statuses explicit during rollout.

## Local verification, 2026-10-27

- Runtime: 13 files, 165 tests pass through `scripts/run_tests.sh`, including the existing real
  loopback sender, fresh-recipient consent, old-window isolation, canonical authorization and
  profile scope. Regressions for a custom remote destination, a legacy install window, HTTP
  redirects and missing canonical RPCs were reproduced before their fixes.
- Desktop: 27 tests pass; desktop, dashboard and API-admin TypeScript checks pass. The existing
  admin view and locale coverage have 6 passing tests. Targeted Ruff/ESLint and diff checks pass.
- API: aggregate-validation unit tests and temporary PostgreSQL/Redis integration pass, including
  idempotence, payload rejection, identity separation, quota after deletion and the unchanged
  authenticated support-log lifecycle. The embedded v4 schema remains byte-identical to the
  runtime artifact.
- The prior full-suite billing-memory failure was reproduced with heap profiles. A repository-free
  fallback resolver created an unused go-cache janitor on every lookup; the constructor now skips
  that cache while preserving explicitly supplied caches and normal repository-backed caching.
  The original memory threshold and 20,000-lookup test remain unchanged. The repaired full Go unit
  suite passes 23,870 test/subtest results, with 18 skipped and no failures; the complete integration
  suite passes 14,643 results with 16 skipped. These totals include nested Go subtests.
- The isolated, statistics-only candidate passes 29 runtime test files (540 tests, one skipped),
  all 397 API frontend files (3,020 tests), desktop consent tests, and desktop TypeScript checks.
  An initial desktop invocation from the repository root lacked its workspace aliases; the same
  suite was then run through the desktop workspace configuration.

The production API and migration were deployed at revision `22d4b315d`. An isolated desktop
profile enabled sharing through the canonical gateway; the existing sender uploaded one package
containing only the synthetic `hermes.client.active=1` counter. The admin page displayed it as
usage statistics with no account binding. Turning sharing off prevented the second package from
being sent. Only the synthetic record was expired for the test: the admin read was denied and the
existing production purge function removed it. The hourly timer was covered by integration tests,
not by waiting an hour in production. No real user statistics or logs were uploaded, and no paid
model calls were made. Matching installer distribution remains a separate rollout step.
