# Cloud history rollout

This feature changes desktop and Aino-API together. Development does not enable
uploads from an existing installed desktop. No installer is published by this task.

## Dependency and migration order

1. Land the existing desktop Agent Hub fixes in PR #32 before integrating the cloud
   branch. Rebase the cloud-only commits onto the resulting main commit, particularly
   if PR #32 was squash merged. Re-run the affected checks after rebasing.
2. Review and land Aino-API's cloud branch. Migration
   `254_desktop_cloud_sync.sql` adds private account-scoped storage; it does not
   migrate transcripts or device credentials. Apply it using the normal API
   migration mechanism before serving the new endpoints.
3. Verify existing login, device key, model catalog and billing routes against the
   new API. The sync endpoints accept account JWTs, not inference device keys.
4. Build a local desktop pilot from the reviewed source. Test with isolated fixture
   accounts first. A live pilot must identify the account whose existing local
   history will be uploaded; do not silently substitute real user data for fixtures.
5. Observe successful history upload, a fresh-device download, continuation, restart,
   offline recovery, conflicts, deletion and account switching before expansion.

## Capacity and operational limits

The initial store is private PostgreSQL JSONB/bytea, with 256 MiB logical quota per
account, 8 MiB per document/blob and 16 MiB per HTTP exchange. Logical accounting
includes durable retry receipts and tombstones. This is separate from inference
billing and subscription model quotas. Synchronization never dispatches model calls.

Blob reclamation and receipt retention require a future explicit policy. Do not
promise that deleting a conversation immediately reclaims all storage: tombstones,
retry evidence and unreferenced blobs remain in this version. PostgreSQL backups,
at-rest protection and TLS remain operational requirements; this version does not
claim end-to-end encryption or transfer local project repositories.

Keep observability to status, latency, byte counts, quota failures and opaque IDs.
Do not log message bodies, attachment data, Authorization headers or login tokens.

## Rollback

Stop the desktop sync coordinator or return to the previous desktop source build;
local history and the durable pending queue remain on that account's device. An
older API may return unavailable for sync while existing desktop functionality keeps
working. Retain the additive database tables during rollback. Dropping them destroys
the only copy of cloud-only history and retry/deletion fences, and is not a normal
rollback step. Resume with the same account and sync store after repairing the issue.

Validation evidence is recorded separately with exact tested revisions. A successful
local fixture run is not a claim that production has been migrated or enabled.
