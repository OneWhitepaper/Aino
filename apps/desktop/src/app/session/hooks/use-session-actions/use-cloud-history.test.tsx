import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { getAllSessionMessages } from '@/hermes'
import { onCloudHistoryChanged } from '@/store/cloud-sync'

import { useCloudHistory } from './use-cloud-history'

vi.mock('@/hermes', () => ({ getAllSessionMessages: vi.fn() }))
vi.mock('@/lib/chat-messages', () => ({ toChatMessages: (rows: unknown) => rows }))
vi.mock('@/store/cloud-sync', () => ({ onCloudHistoryChanged: vi.fn() }))
vi.mock('@/store/session', () => ({
  $sessions: { get: () => [] },
  knownSessionOwner: (_rows: unknown, id: string) =>
    id === 'remote' ? { connectionId: 'ssh', profile: 'default' } : 'default'
}))
vi.mock('@/store/transcript-tail-cache', () => ({ dropTranscriptTail: vi.fn() }))
vi.mock('@/store/transcript-tail', () => ({ clearTranscriptTail: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

test('download invalidation refreshes idle local history and waits for a running turn without touching remote history', async () => {
  vi.useFakeTimers()
  let changed!: (event: any) => void
  vi.mocked(onCloudHistoryChanged).mockImplementation(listener => {
    changed = listener

    return () => {}
  })
  vi.mocked(getAllSessionMessages).mockResolvedValue({
    messages: [{ role: 'user', content: 'remote addition' }]
  } as any)
  const states = new Map<string, any>([
    ['runtime', { storedSessionId: 'local', busy: true, messages: [] }],
    ['remote-runtime', { storedSessionId: 'remote', busy: false, messages: [] }]
  ])

  const update = vi.fn((id, next) => {
    const value = next(states.get(id))
    states.set(id, value)

    return value
  })

  const sync = vi.fn()
  const { unmount } = renderHook(() =>
    useCloudHistory({
      activeSessionIdRef: { current: 'runtime' },
      sessionStateByRuntimeIdRef: { current: states },
      selectedStoredSessionIdRef: { current: 'local' },
      updateSessionState: update,
      syncSessionStateToView: sync
    })
  )
  act(() => changed({ changed_session_ids: ['local', 'remote'] }))
  expect(getAllSessionMessages).not.toHaveBeenCalled()
  states.get('runtime').busy = false
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledExactlyOnceWith('local', { connectionId: 'local', profile: 'default' })
  expect(states.get('runtime').messages).toEqual([{ role: 'user', content: 'remote addition' }])
  expect(sync).toHaveBeenCalledOnce()
  expect(states.get('remote-runtime').messages).toEqual([])
  unmount()
})

function historyHarness() {
  let changed!: (event: any) => void
  vi.mocked(onCloudHistoryChanged).mockImplementation(listener => {
    changed = listener

    return () => {}
  })
  const states = new Map<string, any>([
    ['runtime', { storedSessionId: 'local', busy: false, messages: ['old history'] }]
  ])
  const sync = vi.fn()

  const update = vi.fn((id, next) => {
    const value = next(states.get(id))
    states.set(id, value)

    return value
  })

  const options = {
    activeSessionIdRef: { current: 'runtime' },
    sessionStateByRuntimeIdRef: { current: states },
    selectedStoredSessionIdRef: { current: 'local' },
    updateSessionState: update,
    syncSessionStateToView: sync
  }

  const hook = renderHook(() => useCloudHistory(options))

  return { ...hook, states, sync, changed: () => act(() => changed({ changed_session_ids: ['local'] })) }
}

test('an old rejected read preserves a newer invalidation and waits for the active turn before recovering', async () => {
  vi.useFakeTimers()
  let rejectOld!: (reason: Error) => void
  vi.mocked(getAllSessionMessages)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        })
    )
    .mockResolvedValueOnce({ messages: ['latest persisted history'] } as any)
  const harness = historyHarness()
  harness.changed()
  harness.changed()
  harness.states.get('runtime').busy = true
  await act(async () => {
    rejectOld(new Error('gateway disconnected'))
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(1)
  expect(harness.sync).not.toHaveBeenCalled()
  harness.states.get('runtime').busy = false
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(2)
  expect(harness.states.get('runtime').messages).toEqual(['latest persisted history'])
  expect(harness.sync).toHaveBeenCalledOnce()
  harness.unmount()
})

test('failed reads retain the sole invalidation and back off before a successful retry', async () => {
  vi.useFakeTimers()
  vi.mocked(getAllSessionMessages)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ messages: ['recovered persisted history'] } as any)
  const harness = historyHarness()
  await act(async () => {
    harness.changed()
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(2)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(3)
  expect(harness.states.get('runtime').messages).toEqual(['recovered persisted history'])
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })
  expect(getAllSessionMessages).toHaveBeenCalledTimes(3)
  harness.unmount()
})
