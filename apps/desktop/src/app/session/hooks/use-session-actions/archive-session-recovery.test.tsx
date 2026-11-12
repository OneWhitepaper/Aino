import { act, cleanup, render } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  deleteSession,
  getApiRequestConnection,
  getApiRequestProfile,
  type SessionInfo,
  setApiRequestConnection,
  setApiRequestProfile,
  setSessionArchived,
  setSessionPinnedRemote
} from '@/hermes'
import { $pinnedSessionIds } from '@/store/layout'
import { $notifications, resetNotifications, runNotificationAction } from '@/store/notifications'
import { $messagingSessions, $sessions, setMessagingSessions, setSessions } from '@/store/session'
import { $archivedSessions } from '@/store/sidebar-archive'

import type { ClientSessionState } from '../../../types'

import { useSessionActions } from './index'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setSessionArchived: vi.fn(),
  deleteSession: vi.fn(),
  setSessionPinnedRemote: vi.fn().mockResolvedValue({ ok: true })
}))

type Handle = Pick<ReturnType<typeof useSessionActions>, 'archiveSession' | 'removeSession'>

function Harness({ ready }: { ready: (handle: Handle) => void }) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef: ref<string | null>(null),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: () => 'token',
    getRoutedStoredSessionId: () => null,
    navigate: vi.fn() as never,
    requestGateway: vi.fn().mockResolvedValue(undefined),
    resetViewSync: vi.fn(),
    routedSessionId: null,
    runtimeIdByStoredSessionIdRef: ref(new Map<string, string>()),
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef: ref<string | null>(null),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    syncSessionStateToView: vi.fn(),
    updateSessionState: () => ({}) as ClientSessionState
  })

  ready(actions)

  return null
}

const row = {
  id: 'tip',
  _lineage_root_id: 'root',
  title: 'Research notes',
  profile: 'research',
  connection_id: 'server-a',
  source: 'telegram',
  message_count: 4,
  started_at: 1,
  last_active: 2,
  ended_at: null
} as SessionInfo

let originalConnection: ReturnType<typeof getApiRequestConnection>
let originalProfile: ReturnType<typeof getApiRequestProfile>

beforeEach(() => {
  originalConnection = getApiRequestConnection()
  originalProfile = getApiRequestProfile()
  setApiRequestConnection('server-a')
  setApiRequestProfile('research')
  setSessions([])
  setMessagingSessions([row])
  $archivedSessions.set([])
  $pinnedSessionIds.set(['root'])
  resetNotifications()
  vi.mocked(setSessionArchived).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(deleteSession).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(setSessionPinnedRemote).mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  resetNotifications()
  setSessions([])
  setMessagingSessions([])
  $archivedSessions.set([])
  $pinnedSessionIds.set([])
  setApiRequestConnection(originalConnection)
  setApiRequestProfile(originalProfile)
  vi.useRealTimers()
})

function mount() {
  let handle!: Handle
  render(
    <Harness
      ready={value => {
        handle = value
      }}
    />
  )

  return handle
}

it('keeps history and offers an eight-second Undo that restores the exact source and original pin', async () => {
  vi.useFakeTimers()
  const handle = mount()
  await act(() => handle.archiveSession('tip', { throwOnError: true }))
  expect(setSessionArchived).toHaveBeenCalledWith('tip', true, { connectionId: 'server-a', profile: 'research' })
  expect($messagingSessions.get()).toEqual([])
  const notice = $notifications.get()[0]
  expect(notice.action?.label).toBe('Undo')
  act(() => vi.advanceTimersByTime(7_999))
  expect($notifications.get()).toContain(notice)
  await act(() => runNotificationAction(notice.id, 'action'))
  expect(setSessionArchived).toHaveBeenLastCalledWith('tip', false, { connectionId: 'server-a', profile: 'research' })
  expect(setSessionPinnedRemote).toHaveBeenCalledWith('root', true, { connectionId: 'server-a', profile: 'research' })
  expect($messagingSessions.get().map(item => item.id)).toEqual(['tip'])
  expect($sessions.get()).toEqual([])
  expect($pinnedSessionIds.get()).toContain('root')

  await act(() => handle.archiveSession('tip'))
  act(() => vi.advanceTimersByTime(8_001))
  expect($notifications.get()).toEqual([])
})

it('rejects an unsuccessful archive for inline retry and never offers an Undo for failed work', async () => {
  const handle = mount()
  vi.mocked(setSessionArchived).mockResolvedValue({ ok: false })
  await act(async () => {
    await expect(handle.archiveSession('tip', { throwOnError: true })).rejects.toThrow()
  })
  expect($messagingSessions.get().map(item => item.id)).toEqual(['tip'])
  expect($notifications.get()).toEqual([])
})

it('restores the conversation when Undo succeeds even if restoring its pin needs a retry', async () => {
  const handle = mount()
  await act(() => handle.archiveSession('tip'))
  const notice = $notifications.get()[0]
  vi.mocked(setSessionPinnedRemote).mockRejectedValueOnce(new Error('Pin unavailable'))
  await act(() => runNotificationAction(notice.id, 'action'))
  expect($messagingSessions.get().map(item => item.id)).toEqual(['tip'])
  expect($archivedSessions.get()).toEqual([])
  expect($pinnedSessionIds.get()).not.toContain('root')
  await act(() => runNotificationAction(notice.id, 'action'))
  expect($pinnedSessionIds.get()).toContain('root')
})

it.each(['archiveSession', 'removeSession'] as const)(
  'keeps the confirming row mounted during %s and a failed write',
  async action => {
    const handle = mount()
    let reject!: (error: Error) => void
    const mutate = action === 'archiveSession' ? vi.mocked(setSessionArchived) : vi.mocked(deleteSession)
    mutate.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    let outcome!: Promise<unknown>
    act(() => {
      outcome = handle[action]('tip', { throwOnError: true }).catch(error => error)
    })
    expect($messagingSessions.get().map(item => item.id)).toEqual(['tip'])
    await act(async () => {
      reject(new Error('Write refused'))
      await outcome
    })
    expect(await outcome).toBeInstanceOf(Error)
    expect($messagingSessions.get().map(item => item.id)).toEqual(['tip'])
    expect($notifications.get()).toEqual([])
  }
)

it('retires late completion and captured Undo after an account or source reset', async () => {
  const handle = mount()
  await act(() => handle.archiveSession('tip'))
  const capturedUndo = $notifications.get()[0].action!
  resetNotifications()
  setApiRequestConnection('server-b')
  await expect(capturedUndo.onClick()).rejects.toThrow(/changed/)
  expect(setSessionArchived).toHaveBeenCalledTimes(1)

  setApiRequestConnection('server-a')
  setMessagingSessions([row])
  let reject!: (error: Error) => void
  vi.mocked(setSessionArchived).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  let pending!: Promise<void>
  act(() => {
    pending = handle.archiveSession('tip')
  })
  act(() => {
    resetNotifications()
    setMessagingSessions([])
  })
  await act(async () => {
    reject(new Error('Old request failed'))
    await pending
  })
  expect($messagingSessions.get()).toEqual([])
  expect($notifications.get()).toEqual([])
})
