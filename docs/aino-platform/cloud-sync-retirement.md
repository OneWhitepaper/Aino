# Cloud history synchronization removed

Aino no longer synchronizes conversation history or robot configuration between
devices. This feature is retired, with no user-facing re-enable switch.

The desktop no longer creates a synchronization worker, schedules exchanges,
uploads/downloads sync blobs, subscribes to sync status, or offers cloud-history
status and retry controls. The Python sync adapter, its import/merge helpers,
resume synchronization hooks, and sync-only storage bookkeeping are removed.
Old native IPC status/retry channels return a disabled snapshot without work so
an already-open older renderer cannot restart synchronization.

Local session databases, profiles, drafts, attachments, archive/delete behavior,
account isolation, and multi-window session notifications remain in place.
Files previously imported into local history remain readable, including media
that already exists under a local `cloud-sync/media/` directory. Retiring this
feature does not delete local history or those attachments.

The matching Aino API change removes only its desktop sync routes and dedicated
handler/service/repository. Forward migration
`256_remove_desktop_cloud_sync.sql` removes the four sync-only tables:

- `desktop_sync_operations`
- `desktop_sync_documents`
- `desktop_sync_blobs`
- `desktop_sync_accounts`

The migration deliberately does not use `CASCADE`. It does not modify user
accounts, subscriptions, billing, model routes, device credentials, or device
display metadata. Historical migrations remain so an existing database can
upgrade normally. Applying this API release and its migration is the point at
which the old server-side sync data is deleted; editing desktop sources alone
does not delete production data.
