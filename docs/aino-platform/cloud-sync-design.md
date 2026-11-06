# Account cloud history synchronization

Status: implementation authorized by the user on 2026-11-06.

## User contract

The original computer remains usable. Signing in on another computer automatically
downloads the account's history. Opening a downloaded conversation permits a new
turn. Offline local changes survive application exit and are reconciled later.
No desktop installer is published by this work.

## Architecture

Local Hermes SQLite remains the immediate source of truth for execution. A native
Electron coordinator, scoped to the authenticated account and its home, drives a
Python synchronization adapter and the existing platform API. Credentials stay in
the native authentication service; the adapter never stores or receives bearer
tokens. The adapter uses the existing SessionDB portability and mutation guards.
The server stores revisioned, account-owned documents. Uploads are durable before
dispatch, use stable operation IDs and compare-and-swap revisions. Failed requests
are retryable after restart. Synchronization never calls an inference endpoint.

An entire idle conversation lineage is the unit of reconciliation. Unchanged
documents are not uploaded. The first implementation sends changed snapshots,
not per-token writes. Raw SQLite files, execution admissions, worker ownership,
device keys, login tokens, local permissions and processes are never synchronized.
Portable model choice is retained without credentials; the receiving device uses
its own normal model authorization. Local project roots are not implicitly
trusted or recreated on another machine.

## Platform wire contract (v1)

Authenticated `POST /api/v1/desktop/sync/exchange`, using the ordinary response
envelope (`data`). Request:

```json
{"version":1,"device_id":"installation-id","after":"0","limit":50,
 "operations":[{"operation_id":"uuid","key":"conversation/default/id",
 "base_revision":"0","deleted":false,"payload":{"schema":1}}]}
```

All revisions/cursors are decimal strings. Keys are 1–256 ASCII characters from
`[A-Za-z0-9._:/-]`. Device IDs are bounded nonempty strings. Operation IDs are UUIDs.
At most 16 operations and 50 returned changes per exchange; requests/documents are
bounded (16 MiB request, 8 MiB document). A per-account serialized revision counter
must advance in the same transaction as writes, so pagination cannot miss an
earlier uncommitted write. The server derives user ownership solely from JWT auth.

```json
{"cursor":"12","has_more":false,"results":[
 {"operation_id":"uuid","status":"applied","record":
  {"key":"conversation/default/id","revision":"12","deleted":false,
   "payload":{"schema":1},"device_id":"installation-id"}}],"changes":[]}
```

`status` is `applied` or `conflict`; a conflict includes the current record.
Retrying an identical operation returns its original result. Reusing an operation
ID with different content is rejected. A deleted key cannot be resurrected;
explicitly recovered/conflicting work receives a new identity. Tombstones and
operation receipts must remain durable. The service has an account byte quota
(initial default 256 MiB), counts document replacements correctly, and rejects
oversized or malformed input without partial publication.

Attachments use authenticated `PUT` and `GET`
`/api/v1/desktop/sync/blobs/:sha256`, with raw bytes and an 8 MiB per-blob limit.
Hash and ownership are verified. Blobs are immutable and scoped to the account,
even if another user has the same hash. Initial storage can use private PostgreSQL
bytea alongside JSONB documents: no new public bucket or operational dependency.
Quota includes blobs. This bounded initial backend can later move behind an object
storage adapter without changing portable references. TLS and normal database
at-rest protection apply; this release does not claim end-to-end encryption.

## Local synchronization boundary

Python module `hermes_cli.cloud_sync` exposes a bounded JSON stdin/stdout interface
for native desktop use. Operations are `prepare`, `apply`, and `status`; the request
contains explicit `home` and `ui_root` resolved by native account isolation, never
an arbitrary renderer path. `prepare` returns an exchange request and required
blob uploads, `apply` consumes the server response and downloaded blobs, commits
receipts/cursor with local changes, and returns changed session/profile IDs and
status. Exact shapes are shared in the implementation plan and fixture tests.
The Python adapter is responsible for its durable outbox, cursor, content hashes,
pending downloads, and local conflict copies. Native code owns network retries,
account generation fencing, worker cancellation and UI status publication.

Export full archival flags and context (`include_inactive=True`), preserve message
UIDs and compression lineage. Reuse import validation and strip device-specific
authority/credentials. Extend portability only where existing imports skip IDs.
Apply only under a write transaction with existing idle/lease guards; busy or
unknown sessions remain pending and their cursor cannot silently acknowledge
lost work. A crash before acknowledgement must not duplicate messages.

If local content and remote content both differ from the common acknowledged
revision, preserve the local version as a newly identified, visibly named conflict
conversation before adopting the remote version. Remap lineage/message references
consistently. Do not mutate a running model turn or its cached prefix. Deletion
propagates through tombstones, while offline divergent work is preserved as a
conflict copy rather than resurrecting the deleted key.

Named bot profiles retain identity and non-secret descriptive configuration, so
their canonical Bot Chat remains associated with the correct bot. Do not copy
the global profile directory or credentials. Attachments are explicit portable
references to uploaded blobs; only regular files within the owning home or UI
attachment directories may be read, without following escaping symlinks. Remote
files are written into a private account media directory with hash-based names.
Missing/oversized attachments are reported, never silently marked synchronized.
Running tools and uncertain side effects become history only; opening a restored
chat does not execute them. A new user submission is required for any model turn.

## Native lifecycle and UX

Start automatically after an authenticated account workspace is ready. Use one
serialized coordinator per native process, periodic bounded polling (15 seconds)
and a manual retry action. Only local, account-owned homes are synchronized;
arbitrary SSH/remote gateway workspaces are excluded. Logout/account change aborts
network and child work and fences late results before the next workspace activates.
Offline errors preserve local access and outbox. The renderer sees status and
history invalidations, never credentials or raw sync filesystem capabilities.
Show synced, syncing, pending/offline, and failed/unavailable states honestly.

## Acceptance

Use two independent temporary homes and a local test API. Create on A, synchronize,
open/continue on B using the real persistence/resume path, synchronize back to A.
Verify attachments, compression flags, bot identity, offline restart, response-loss
retry, concurrent edits, tombstones, busy turns, account-switch races and hostile
paths. No duplicate model execution, messages or billing calls may arise from sync.
Run repository checks and relevant Python, native/renderer and Go tests. Production
migrations/deployment and real account uploads require a separately reviewed rollout;
development and local integration continue without waiting for that rollout.
