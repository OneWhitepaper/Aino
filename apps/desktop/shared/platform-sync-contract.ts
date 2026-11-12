/** Compatibility status for retired native cloud-sync IPC channels. */
export interface CloudSyncStatus {
  state: 'disabled' | 'syncing' | 'synced' | 'pending' | 'offline' | 'failed' | 'unavailable'
  pending: number
  error: string | null
  changed_session_ids: string[]
  changed_profile_ids: string[]
  revision: number
}
