import { createHash, randomUUID } from 'node:crypto'

import type { PlatformAuth } from '../shared/platform-auth'
import type { PlatformDeviceOwner } from '../shared/platform-contract'
import type { CloudSyncStatus, SyncExchange, SyncResponse } from '../shared/platform-sync-contract'
import { SYNC_BLOB_LIMIT } from '../shared/platform-sync-contract'

import type { AccountWorkspace } from './account-workspace'

export interface LocalSyncStatus {
  state: 'synced' | 'pending' | 'blocked'
  pending: number
  issues: Array<{ code?: string }>
}
export interface LocalSyncReply {
  ok: true
  request_id?: string
  exchange?: SyncExchange
  uploads?: Array<{ sha256: string; size: number }>
  sha256?: string
  data_base64?: string
  pending_response?: SyncResponse | null
  status: LocalSyncStatus
  changed_session_ids?: string[]
  changed_profile_ids?: string[]
  pending_downloads?: string[]
  has_more?: boolean
}
export type LocalSyncCall = (
  workspace: AccountWorkspace,
  input: Record<string, unknown>,
  signal: AbortSignal
) => Promise<LocalSyncReply>

interface ExchangeContext {
  auth: Pick<PlatformAuth, 'syncBlob'>
  owner: PlatformDeviceOwner
  signal: AbortSignal
  call(input: Record<string, unknown>): Promise<LocalSyncReply>
  guard(): void
}

async function uploadBlobs(prepared: LocalSyncReply, context: ExchangeContext) {
  const { auth, owner, signal, call, guard } = context

  for (const blob of prepared.uploads ?? []) {
    if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > SYNC_BLOB_LIMIT) {
      throw new Error('invalid_sync_blob')
    }
    const loaded = await call({ action: 'read_blob', sha256: blob.sha256 })

    if (loaded.sha256 !== blob.sha256 || typeof loaded.data_base64 !== 'string') {
      throw new Error('invalid_sync_blob')
    }
    const bytes = Buffer.from(loaded.data_base64, 'base64')

    if (bytes.length !== blob.size || createHash('sha256').update(bytes).digest('hex') !== blob.sha256) {
      throw new Error('invalid_sync_blob')
    }
    guard()
    await auth.syncBlob(blob.sha256, bytes, owner, signal)
    guard()
  }
}

function changes(applied: LocalSyncReply): Partial<CloudSyncStatus> {
  return {
    changed_session_ids: applied.changed_session_ids ?? [],
    changed_profile_ids: applied.changed_profile_ids ?? []
  }
}

function localStatus(applied: LocalSyncReply): Partial<CloudSyncStatus> {
  return {
    ...changes(applied),
    state:
      applied.status.state === 'blocked'
        ? 'failed'
        : applied.has_more && applied.status.state === 'synced'
          ? 'pending'
          : applied.status.state,
    pending: Math.max(applied.status.pending, applied.has_more ? 1 : 0),
    error: applied.status.issues.some(issue => issue.code === 'attachment_too_large')
      ? 'attachment_too_large'
      : applied.status.issues.length
        ? 'sync_local_issues'
        : null
  }
}

async function downloadBlobs(
  prepared: LocalSyncReply,
  response: SyncResponse,
  initial: LocalSyncReply,
  context: ExchangeContext,
  publish: (status: Partial<CloudSyncStatus>) => void
) {
  const { auth, owner, signal, call, guard } = context
  let applied = initial

  // Feed one blob at a time so private JSON stays bounded for pages with many attachments.
  for (const hash of initial.pending_downloads ?? []) {
    guard()
    const bytes = await auth.syncBlob(hash, null, owner, signal)
    guard()

    if (bytes.length > SYNC_BLOB_LIMIT || createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error('invalid_sync_blob')
    }
    applied = await call({
      action: 'apply',
      request_id: prepared.request_id,
      response,
      blobs: [{ sha256: hash, data_base64: Buffer.from(bytes).toString('base64') }]
    })
    publish(changes(applied))
  }

  return applied
}

export function createAccountCloudSync({
  auth,
  local,
  deviceId,
  intervalMs = 15_000
}: {
  auth: Pick<PlatformAuth, 'snapshot' | 'generation' | 'syncExchange' | 'syncBlob'>
  local: LocalSyncCall
  deviceId: () => string
  intervalMs?: number
}) {
  let workspace: AccountWorkspace | null = null
  let controller: AbortController | null = null
  let flight: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let epoch = 0
  let failures = 0
  let status: CloudSyncStatus = {
    state: 'disabled',
    pending: 0,
    error: null,
    revision: 0,
    changed_session_ids: [],
    changed_profile_ids: []
  }
  const listeners = new Set<(status: CloudSyncStatus) => void>()

  function publish(patch: Partial<CloudSyncStatus>) {
    status = { ...status, ...patch, revision: status.revision + 1 }

    for (const listener of listeners) {
      listener(status)
    }
  }

  function check(expected: number, generation: number, home: AccountWorkspace, signal: AbortSignal) {
    if (
      signal.aborted ||
      expected !== epoch ||
      auth.generation() !== generation ||
      auth.snapshot().account?.id !== home.userId
    ) {
      throw new Error('sync_superseded')
    }
  }

  async function exchange(home: AccountWorkspace, expected: number, signal: AbortSignal) {
    const generation = auth.generation()
    const owner = { expected_user_id: home.userId!, expected_generation: generation }
    const guard = () => check(expected, generation, home, signal)

    const call = async (input: Record<string, unknown>) => {
      guard()
      const result = await local(home, input, signal)
      guard()

      return result
    }

    publish({ state: 'syncing', error: null, changed_session_ids: [], changed_profile_ids: [] })

    for (let page = 0; page < 4; page++) {
      const prepared = await call({ action: 'prepare', request_id: randomUUID(), device_id: deviceId() })

      if (!prepared.exchange || !prepared.request_id) {
        throw new Error('sync_adapter_unavailable')
      }
      publish({ pending: prepared.status.pending })
      const context = { auth, owner, signal, call, guard }
      await uploadBlobs(prepared, context)
      let response: SyncResponse

      try {
        response = prepared.pending_response ?? (await auth.syncExchange(prepared.exchange, owner, signal))
      } catch (error) {
        guard()

        if (
          (error as { code?: string }).code !== 'DESKTOP_SYNC_REBATCH' ||
          prepared.pending_response ||
          prepared.exchange.operations.length < 2
        ) {
          throw error
        }
        const recovered = await call({ action: 'rebatch', request_id: prepared.request_id })
        publish(localStatus(recovered))

        continue
      }

      guard()
      const initial = await call({ action: 'apply', request_id: prepared.request_id, response })
      publish(changes(initial))
      const applied = await downloadBlobs(prepared, response, initial, context, publish)
      publish(localStatus(applied))

      if (!applied.has_more || applied.status.pending) {
        break
      }
    }
  }

  function tick(): Promise<void> {
    if (flight) {
      return flight
    }

    if (!workspace?.userId) {
      return Promise.resolve()
    }
    const home = workspace
    const expected = epoch
    controller = new AbortController()
    const signal = controller.signal
    flight = exchange(home, expected, signal)
      .then(() => {
        failures = 0
      })
      .catch(error => {
        if (signal.aborted || expected !== epoch) {
          return
        }
        const candidate = typeof error?.code === 'string' ? error.code : error instanceof Error ? error.message : ''
        const code = /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : 'sync_failed'

        if (['sync_superseded', 'auth_attempt_superseded', 'platform_account_changed'].includes(code)) {
          return
        }
        failures = code.startsWith('network_') || code === 'http_503' ? failures + 1 : 0
        publish({
          state: ['sync_unavailable', 'sync_adapter_unavailable'].includes(code)
            ? 'unavailable'
            : code.startsWith('network_')
              ? 'offline'
              : 'failed',
          error: code
        })
      })
      .finally(() => {
        flight = null

        if (expected === epoch && workspace && status.state !== 'unavailable') {
          const delay = Math.min(intervalMs * 2 ** Math.min(failures, 4), 300_000)
          timer = setTimeout(() => {
            timer = null
            void tick()
          }, delay)
        }
      })

    return flight
  }

  return {
    snapshot: () => status,
    subscribe(listener: (status: CloudSyncStatus) => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    async stop() {
      epoch++
      workspace = null

      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      controller?.abort()
      publish({ state: 'disabled', pending: 0, error: null, changed_session_ids: [], changed_profile_ids: [] })
      await flight
    },
    start(home: AccountWorkspace) {
      if (!home.userId || auth.snapshot().account?.id !== home.userId) {
        return
      }

      if (workspace?.key === home.key) {
        return
      }

      if (workspace || flight) {
        throw new Error('sync_workspace_not_retired')
      }
      workspace = home
      failures = 0
      epoch++
      void tick()
    },
    async retry() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await tick()

      return status
    }
  }
}
