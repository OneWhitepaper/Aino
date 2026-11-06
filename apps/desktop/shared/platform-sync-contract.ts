/** Native-only wire data. Renderer receives status and invalidations, never documents. */
export interface SyncRecord {
  key: string
  revision: string
  deleted: boolean
  payload?: Record<string, unknown> | null
  device_id: string
}
export interface SyncExchange {
  version: 1
  device_id: string
  after: string
  limit: number
  operations: Array<{ operation_id: string; key: string; base_revision: string; deleted: boolean; payload?: Record<string, unknown> | null }>
}
export interface SyncResponse {
  cursor: string
  has_more: boolean
  results: Array<{ operation_id: string; status: 'applied' | 'conflict'; record: SyncRecord }>
  changes: SyncRecord[]
}
export interface CloudSyncStatus {
  state: 'disabled' | 'syncing' | 'synced' | 'pending' | 'offline' | 'failed' | 'unavailable'
  pending: number
  error: string | null
  changed_session_ids: string[]
  changed_profile_ids: string[]
  revision: number
}
export interface CloudSyncBridge {
  status(): Promise<CloudSyncStatus>
  retry(): Promise<CloudSyncStatus>
  onChanged(listener: (status: CloudSyncStatus) => void): () => void
}
export const SYNC_BLOB_LIMIT = 8 * 1024 * 1024
export const SYNC_JSON_LIMIT = 16 * 1024 * 1024

export function parseSyncResponse(value: unknown): SyncResponse {
  const fail = () => { throw new Error('invalid_sync_response') }

  if (!value || typeof value !== 'object') { return fail() }
  const data = value as SyncResponse
  const decimal = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v)

  const record = (v: SyncRecord) => v && /^[A-Za-z0-9._:/-]{1,256}$/.test(v.key) && decimal(v.revision) &&
    typeof v.deleted === 'boolean' && typeof v.device_id === 'string' &&
    (v.deleted || v.payload !== null && typeof v.payload === 'object' && !Array.isArray(v.payload))

  if (!decimal(data.cursor) || typeof data.has_more !== 'boolean' || !Array.isArray(data.results) ||
      data.results.length > 16 || !Array.isArray(data.changes) || data.changes.length > 50 ||
      !data.changes.every(record) || !data.results.every(result => result &&
        typeof result.operation_id === 'string' && ['applied', 'conflict'].includes(result.status) && record(result.record))) { return fail() }

  return data
}
