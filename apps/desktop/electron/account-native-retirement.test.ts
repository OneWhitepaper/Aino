import { expect, test, vi } from 'vitest'

import { createLocalBackendLifecycle } from './local-backend-lifecycle'
import { createQuickEntrySubmitRelay } from './quick-entry'

function deferred() {
  let release!: () => void

  const promise = new Promise<void>(resolve => {
    release = resolve
  })

  return { promise, release }
}

test('retiring a quick entry resolves old callers and discards late acknowledgements before reuse', async () => {
  vi.useFakeTimers()
  const onSuccess = vi.fn()
  const onLateResult = vi.fn()
  const relay = createQuickEntrySubmitRelay({ onSuccess, onLateResult, timeoutMs: 10 })
  const ids: string[] = []

  try {
    const expired = relay.begin(id => ids.push(id))
    await vi.advanceTimersByTimeAsync(10)
    await expired
    const pending = relay.begin(id => ids.push(id))
    relay.retire()
    await expect(pending).resolves.toMatchObject({ code: 'account_changed', retryable: false })
    expect(relay.pendingCount()).toBe(0)
    expect(relay.reconcilableCount()).toBe(0)

    for (const id of ids) {
      relay.acknowledge(id, { ok: true, sessionId: 'private-A' })
    }

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onLateResult).not.toHaveBeenCalled()
    let nextId = ''

    const next = relay.begin(id => {
      nextId = id
    })

    relay.acknowledge(nextId, { ok: true, sessionId: 'B' })
    await expect(next).resolves.toMatchObject({ sessionId: 'B' })
    expect(onSuccess).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})

test('runtime retirement drains admitted startup and recycle work without shutting down the shared installation', async () => {
  const runtime = createLocalBackendLifecycle({ stopChild: vi.fn(), waitForExit: vi.fn(), cancelSetup: vi.fn() })
  const old = deferred()
  const started = vi.fn()

  const pending = runtime.start(async () => {
    started()
    await old.promise
  }, 'local')

  await Promise.resolve()
  expect(started).toHaveBeenCalledOnce()
  const recycle = runtime.recycle('local', async () => undefined)
  let drained = false

  const draining = runtime.drain().then(() => {
    drained = true
  })

  await Promise.resolve()
  expect(drained).toBe(false)
  old.release()
  await Promise.all([pending, recycle, draining])
  expect(drained).toBe(true)
  expect(runtime.signal.aborted).toBe(false)
  await expect(runtime.start(async () => 'new-account', 'local')).resolves.toBe('new-account')
})
