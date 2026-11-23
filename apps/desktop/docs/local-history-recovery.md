# Local history after the account-workspace upgrade

The native **Sync local records** action reads a consistent private snapshot of
pre-account history. It filters every profile by the signed-in platform origin
and user ID; unowned history requires confirmation, and another account's records
are never imported. A claim ledger makes confirmation account-bound across retries.

## Execution, not just a transcript

For canonical local conversations, the native helper projects the saved execution
policy into portable launch choices: Work/Code, model source and ID, provider/wire,
reasoning, and the actual workspace. It does **not** transfer an old principal,
control ticket, launch credential reference, or private policy/config secrets.
The existing authenticated session importer claims history for the target actor;
normal native resume then creates a new target-profile execution binding. Missing
model credentials must be configured in the current account; migration does not
silently change the selected provider or billing channel.

The session list shows the saved mode before the first resume. Bot Chats retain
the existing follow-profile-model behavior, while keeping their execution mode.
Group history stays a read-only archive.

## Code files

After profile creation and a target-history backup, a native runtime step checks
the approved batch again. Only its referenced native Codex thread logs and owned
projectless workspaces are copied. Structured cwd fields are relocated; external
projects keep their existing paths. Native thread UUIDs remain unchanged, and
Codex rebuilds its local index from the selected rollouts. Auth/config files,
credential files, projectless `.git` metadata, unrelated threads and shared runtime
databases are not copied (external project repositories are left in place).
Existing destination files win; source files are never changed or removed.
Unsafe paths, ambiguous thread IDs, missing native rollouts and size limits are
reported as failures rather than claiming a fresh thread is the restored one.

## Retry and repair

New history and deleted-session fences are preserved. Repeating synchronization
is idempotent. Earlier transcript-only imports can be repaired through the same
import transaction with `restore_execution: true`, but only when the current
actor owns the original import binding, account stamps match, the transcript has
not changed and no execution policy/route has been established. Generic imports
remain insert-or-skip. A stale revision or changed transcript requires inspecting
again; recovery never overwrites a conversation that has since become active.

Backups remain under the native user-data `legacy-history-recovery/plans` folder.
The automated lifecycle regression uses isolated homes, a loopback model service
and the explicit bundled Codex binary: sync → send → restart owner → send again.
