import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { getAllSessionMessages } from '@/hermes'
import { onCloudHistoryChanged } from '@/store/cloud-sync'

import { useCloudHistory } from './use-cloud-history'

vi.mock('@/hermes', () => ({ getAllSessionMessages: vi.fn() }))
vi.mock('@/lib/chat-messages', () => ({ toChatMessages: (rows: unknown) => rows }))
vi.mock('@/store/cloud-sync', () => ({ onCloudHistoryChanged: vi.fn() }))
vi.mock('@/store/session', () => ({ $sessions: { get: () => [] }, knownSessionOwner: (_rows: unknown, id: string) => id === 'remote' ? { connectionId: 'ssh', profile: 'default' } : 'default' }))
vi.mock('@/store/transcript-tail-cache', () => ({ dropTranscriptTail: vi.fn() }))
vi.mock('@/store/transcript-tail', () => ({ clearTranscriptTail: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

test('download invalidation refreshes idle local history and waits for a running turn without touching remote history', async () => {
  vi.useFakeTimers()
  let changed!: (event: any) => void
  vi.mocked(onCloudHistoryChanged).mockImplementation(listener => { changed = listener;

 return () => {} })
  vi.mocked(getAllSessionMessages).mockResolvedValue({ messages: [{ role: 'user', content: 'remote addition' }] } as any)
  const states = new Map<string, any>([['runtime', { storedSessionId: 'local', busy: true, messages: [] }], ['remote-runtime', { storedSessionId: 'remote', busy: false, messages: [] }]])

  const update = vi.fn((id, next) => { const value = next(states.get(id)); states.set(id, value);

 return value })

  const sync = vi.fn()
  const { unmount } = renderHook(() => useCloudHistory({ activeSessionIdRef: { current: 'runtime' }, sessionStateByRuntimeIdRef: { current: states }, selectedStoredSessionIdRef: { current: 'local' }, updateSessionState: update, syncSessionStateToView: sync }))
  act(() => changed({ changed_session_ids: ['local', 'remote'] }))
  expect(getAllSessionMessages).not.toHaveBeenCalled()
  states.get('runtime').busy = false
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(getAllSessionMessages).toHaveBeenCalledExactlyOnceWith('local', { connectionId: 'local', profile: 'default' })
  expect(states.get('runtime').messages).toEqual([{ role: 'user', content: 'remote addition' }])
  expect(sync).toHaveBeenCalledOnce()
  expect(states.get('remote-runtime').messages).toEqual([])
  unmount()
})
