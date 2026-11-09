import { afterEach, expect, test, vi } from 'vitest'

import { createAccountCloudSync } from './account-cloud-sync'

const home = (userId: string) => ({ userId, key: userId, home: `/tmp/${userId}`, ui: `/tmp/${userId}/ui` })
const status = { state: 'synced', pending: 0, issues: [] }
const response = { cursor: '1', has_more: false, results: [], changes: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })

  return { promise, resolve }
}

function setup() {
  let user = 'A'
  let generation = 1

  const auth = {
    snapshot: () => ({ account: { id: user } }),
    generation: () => generation,
    syncExchange: vi.fn(async () => response),
    syncBlob: vi.fn()
  }

  const local = vi.fn(async (_home: any, input: any): Promise<any> =>
    input.action === 'prepare'
      ? { ok: true, request_id: 'stable', exchange: { operations: [] }, uploads: [], status }
      : { ok: true, status, changed_session_ids: ['chat'], changed_profile_ids: ['default'] }
  )

  const sync = createAccountCloudSync({ auth: auth as any, local, deviceId: () => 'device' })

  return {
    auth,
    local,
    sync,
    switchUser() {
      user = 'B'
      generation++
    }
  }
}

afterEach(() => vi.useRealTimers())
test('single-flight polling and retry never overlap an exchange', async () => {
  vi.useFakeTimers()
  const { auth, sync } = setup()
  const pending = deferred<typeof response>()
  auth.syncExchange.mockReturnValue(pending.promise)
  sync.start(home('A'))
  const retry = sync.retry()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(auth.syncExchange).toHaveBeenCalledTimes(1)
  pending.resolve(response)
  await retry
  expect(sync.snapshot().state).toBe('synced')
  await sync.stop()
})
test('retirement drains A and fences late response before B starts', async () => {
  const { auth, local, sync, switchUser } = setup()
  const pending = deferred<typeof response>()
  auth.syncExchange.mockReturnValueOnce(pending.promise)
  sync.start(home('A'))
  await Promise.resolve()
  await Promise.resolve()
  const stopped = sync.stop()
  switchUser()
  pending.resolve(response)
  await stopped
  expect(local.mock.calls.filter(call => call[1].action === 'apply')).toHaveLength(0)
  sync.start(home('B'))
  await sync.retry()
  expect(local.mock.calls.filter(call => call[1].action === 'apply').map(call => call[0].userId)).toEqual(['B'])
  await sync.stop()
})
test('retry uses the durable prepared request and pending response after restart', async () => {
  const { auth, local, sync } = setup()
  auth.syncExchange.mockRejectedValueOnce(Object.assign(new Error(), { code: 'network_unavailable' }))
  sync.start(home('A'))
  await sync.retry()
  expect(sync.snapshot().state).toBe('offline')
  await sync.stop()
  local.mockImplementation(async (_home, input) =>
    input.action === 'prepare'
      ? { ok: true, request_id: 'stable', exchange: { operations: [] }, pending_response: response, status }
      : { ok: true, status }
  )
  sync.start(home('A'))
  await sync.retry()
  expect(auth.syncExchange).toHaveBeenCalledTimes(1)
  expect(local.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'apply', request_id: 'stable', response })
  await sync.stop()
})

test('unsupported cloud sync stops automatic polling and keeps manual retry', async () => {
  vi.useFakeTimers()
  const { auth, sync } = setup()
  auth.syncExchange.mockRejectedValueOnce(Object.assign(new Error(), { code: 'sync_unavailable' }))
  sync.start(home('A'))
  await sync.retry()
  expect(sync.snapshot().state).toBe('unavailable')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(auth.syncExchange).toHaveBeenCalledTimes(1)
  await sync.retry()
  expect(sync.snapshot().state).toBe('synced')
  await sync.stop()
})

test('a bounded four-page poll remains pending until remaining cloud pages arrive', async () => {
  const { auth, local, sync } = setup()
  local.mockImplementation(async (_home, input) =>
    input.action === 'prepare'
      ? { ok: true, request_id: 'stable', exchange: { operations: [] }, status }
      : { ok: true, status, has_more: true }
  )
  sync.start(home('A'))
  await sync.retry()
  expect(auth.syncExchange).toHaveBeenCalledTimes(4)
  expect(sync.snapshot()).toMatchObject({ state: 'pending', pending: 1 })
  await sync.stop()
})

test('a typed size rollback durably re-batches only its pending legacy preparation', async () => {
  const { auth, local, sync } = setup()
  const legacy = { ok: true, request_id: 'old', exchange: { operations: [{}, {}, {}] }, uploads: [], status }
  let recovered = false
  local.mockImplementation(async (_home, input) => {
    if (input.action === 'rebatch') {
      expect(input.request_id).toBe('old')
      recovered = true

      return { ok: true, status: { state: 'pending', pending: 3, issues: [] } }
    }

    if (input.action === 'prepare') {
      return recovered ? { ...legacy, request_id: 'single', exchange: { operations: [{}] } } : legacy
    }
    expect(input.request_id).toBe('single')

    return { ok: true, status }
  })
  auth.syncExchange.mockRejectedValueOnce(Object.assign(new Error(), { code: 'DESKTOP_SYNC_REBATCH' }))
  sync.start(home('A'))
  await sync.retry()
  expect(sync.snapshot().state).toBe('synced')
  expect(local.mock.calls.filter(call => call[1].action === 'rebatch')).toHaveLength(1)
  expect(local.mock.calls.filter(call => call[1].action === 'apply')).toHaveLength(1)
  await sync.stop()
})
