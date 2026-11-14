import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { HermesConnection } from '@/global'
import { I18nProvider } from '@/i18n'
import { invalidateProfileScopedQueries } from '@/lib/query-client'
import type { AccountActions, AccountState } from '@/store/account'
import { $sessionsChangeTick } from '@/store/live-sync'
import { notify } from '@/store/notifications'
import { invalidateProfileListFetches, refreshProfiles } from '@/store/profile'
import { $connection } from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubResizeObserver } from '@/test/jsdom'

import type {
  LegacyHistoryBridge,
  LegacyHistoryInspection,
  LegacyHistoryResult
} from '../../../shared/legacy-history-recovery'
import type { PlatformAccountSnapshot } from '../../../shared/platform-contract'

import { AccountContext } from './account-context'
import { LegacyHistoryRecoveryPrompt } from './legacy-history-recovery'

vi.mock('@/store/notifications', () => ({ notify: vi.fn(() => 'legacy-history') }))
vi.mock('@/lib/query-client', () => ({ invalidateProfileScopedQueries: vi.fn() }))
vi.mock('@/store/profile', () => ({
  invalidateProfileListFetches: vi.fn(),
  refreshProfiles: vi.fn(async () => [])
}))
vi.mock('@/store/session', async () => {
  const { atom } = await import('nanostores')

  return { $connection: atom(null) }
})
stubResizeObserver()

const inspection = (patch: Partial<LegacyHistoryInspection> = {}): LegacyHistoryInspection => ({
  planId: 'plan-a',
  reminderKey: 'batch-a',
  showReminder: true,
  snoozedUntil: null,
  owned: 0,
  unowned: 0,
  foreign: 0,
  conflicts: 0,
  profiles: 1,
  pending: 0,
  ...patch
})

const result: LegacyHistoryResult = { imported: 2, skipped: 0, conflicts: 0, profiles: 1 }

function connectionFor(mode: 'local' | 'remote'): HermesConnection {
  return {
    mode,
    baseUrl: 'http://127.0.0.1:3000',
    wsUrl: 'ws://127.0.0.1:3000',
    token: '',
    isFullscreen: false,
    nativeOverlayWidth: 0,
    windowButtonPosition: null,
    logs: []
  }
}

function owner(id = 'a', revision = 1): PlatformAccountSnapshot {
  return {
    revision,
    phase: 'signed_in',
    account: { id, display_name: id, email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }
}

function account() {
  const snapshot = atom<PlatformAccountSnapshot | null>(owner())

  const state = atom<AccountState>({
    authenticated: true,
    account: owner().account,
    adapter: 'platform',
    capabilities: null,
    fixedCodeHint: false,
    ready: true,
    loading: false,
    phase: 'signed_in',
    rememberState: 'session_only',
    error: null
  })

  return { state, snapshot } as AccountActions
}

function mount(children = <LegacyHistoryRecoveryPrompt />, actions = account()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidation = vi.spyOn(client, 'invalidateQueries')
  vi.mocked(invalidateProfileScopedQueries).mockImplementation(() => {
    void client.invalidateQueries()
  })

  const view = render(
    <I18nProvider configClient={null} initialLocale="zh">
      <QueryClientProvider client={client}>
        <AccountContext.Provider value={actions}>{children}</AccountContext.Provider>
      </QueryClientProvider>
    </I18nProvider>
  )

  return { ...view, client, invalidation, actions }
}

let bridge: LegacyHistoryBridge
beforeEach(() => {
  vi.clearAllMocks()
  $connection.set(connectionFor('local'))
  bridge = {
    inspect: vi.fn().mockResolvedValue(inspection()),
    restore: vi.fn().mockResolvedValue(result),
    remind: vi.fn().mockResolvedValue({ ok: true, reminderKey: 'batch-a', showReminder: false, snoozedUntil: null })
  }
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { ...window.hermesDesktop, legacyHistoryRecovery: bridge }
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

async function card() {
  return screen.findByRole('region', { name: '发现未显示的本地聊天记录' })
}

it.each([
  inspection({ foreign: 8, pending: 2, conflicts: 1 }),
  inspection({ owned: 2, showReminder: false }),
  inspection({ unowned: 2, showReminder: false, snoozedUntil: Date.now() + 86_400_000 })
])('stays silent without eligible missing records or when the reminder is suppressed', async data => {
  vi.mocked(bridge.inspect).mockResolvedValue(data)
  mount()
  await waitFor(() => expect(bridge.inspect).toHaveBeenCalledOnce())
  await act(async () => {})
  expect(screen.queryByRole('region')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(notify).not.toHaveBeenCalled()
})

it('offers a floating card without moving focus or changing a draft', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  mount(
    <>
      <input aria-label="Draft" defaultValue="Keep this draft" />
      <LegacyHistoryRecoveryPrompt />
    </>
  )
  screen.getByLabelText('Draft').focus()
  const prompt = await card()
  expect(within(prompt).getByRole('button', { name: '同步本地记录' })).toBeTruthy()
  expect(within(prompt).getByRole('button', { name: '稍后再说' })).toBeTruthy()
  expect(within(prompt).getByRole('button', { name: '忽略' })).toBeTruthy()
  expect(screen.getByLabelText('Draft')).toBe(window.document.activeElement)
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep this draft')
  expect(notify).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('syncs verified records directly and refreshes real lists without navigation', async () => {
  vi.mocked(bridge.inspect)
    .mockResolvedValueOnce(inspection({ owned: 2 }))
    .mockResolvedValue(inspection({ planId: 'plan-done', showReminder: false }))
  const tick = $sessionsChangeTick.get()
  const { invalidation } = mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  await waitFor(() =>
    expect(bridge.restore).toHaveBeenCalledExactlyOnceWith({
      expectedOwner: { userId: 'a', mode: 'development', revision: 1 },
      planId: 'plan-a',
      includeUnowned: false
    })
  )
  await waitFor(() => expect($sessionsChangeTick.get()).toBe(tick + 1))
  expect(invalidateProfileListFetches).toHaveBeenCalledOnce()
  expect(refreshProfiles).toHaveBeenCalledOnce()
  expect(invalidateProfileScopedQueries).toHaveBeenCalledOnce()
  expect(invalidation).toHaveBeenCalledOnce()
  expect(screen.queryByRole('region')).toBeNull()
  expect(vi.mocked(notify).mock.calls.every(([input]) => !input.persistent)).toBe(true)
})

it('requires ownership confirmation for unowned records and supports cancel', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ unowned: 3, foreign: 7 }))
  mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  const dialog = screen.getByRole('dialog')
  expect((within(dialog).getByRole('button', { name: '同步本地记录' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(bridge.restore).not.toHaveBeenCalled()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '这些旧记录属于当前账号' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '同步本地记录' }))
  await waitFor(() => expect(bridge.restore).toHaveBeenCalledWith(expect.objectContaining({ includeUnowned: true })))
})

it('persists later and hides the card only after the native decision succeeds', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '稍后再说' }))
  await waitFor(() =>
    expect(bridge.remind).toHaveBeenCalledExactlyOnceWith({
      expectedOwner: { userId: 'a', mode: 'development', revision: 1 },
      planId: 'plan-a',
      choice: 'later'
    })
  )
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  expect(bridge.restore).not.toHaveBeenCalled()
})

it('requires a second confirmation before ignoring this update history batch', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '忽略' }))
  const dialog = screen.getByRole('dialog', { name: '忽略这些旧记录？' })
  expect(bridge.remind).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(bridge.remind).not.toHaveBeenCalled()
  fireEvent.click(within(await card()).getByRole('button', { name: '忽略' }))
  fireEvent.click(screen.getByRole('button', { name: '确认忽略' }))
  await waitFor(() => expect(bridge.remind).toHaveBeenCalledWith(expect.objectContaining({ choice: 'ignore' })))
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  expect(bridge.restore).not.toHaveBeenCalled()
})

it('keeps a retry inline after sync failure and blocks duplicate submissions', async () => {
  const pending = deferred<LegacyHistoryResult>()
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  vi.mocked(bridge.restore).mockReturnValueOnce(pending.promise).mockResolvedValue(result)
  mount()
  const sync = within(await card()).getByRole('button', { name: '同步本地记录' })
  fireEvent.click(sync)
  fireEvent.click(sync)
  expect(bridge.restore).toHaveBeenCalledOnce()
  await act(async () => pending.reject(new Error('disk unavailable')))
  expect(screen.getByRole('alert').textContent).toBe('同步未完成，原始记录仍保留。请重试。')
  expect(notify).not.toHaveBeenCalled()
  fireEvent.click(sync)
  await waitFor(() => expect(bridge.restore).toHaveBeenCalledTimes(2))
})

it('retains the card when saving later fails', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  vi.mocked(bridge.remind).mockRejectedValue(new Error('read-only'))
  mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '稍后再说' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(await card()).toBeTruthy()
})

it('does not publish old recovery feedback after switching account', async () => {
  const pending = deferred<LegacyHistoryResult>()
  vi.mocked(bridge.inspect)
    .mockResolvedValueOnce(inspection({ owned: 2 }))
    .mockResolvedValue(inspection())
  vi.mocked(bridge.restore).mockReturnValue(pending.promise)
  const { actions, invalidation } = mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  await act(async () => {
    actions.snapshot.set(owner('b', 2))
    actions.state.set({ ...actions.state.get(), account: owner('b').account })
  })
  await act(async () => pending.resolve(result))
  expect(invalidation).not.toHaveBeenCalled()
  expect(refreshProfiles).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
  expect(screen.queryByRole('region')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('silently ignores inspection failures', async () => {
  vi.mocked(bridge.inspect).mockRejectedValue(new Error('unavailable'))
  mount()
  await waitFor(() => expect(bridge.inspect).toHaveBeenCalled())
  await act(async () => {})
  expect(screen.queryByRole('region')).toBeNull()
  expect(notify).not.toHaveBeenCalled()
})

it('refreshes lists after route unmount without showing a success notification', async () => {
  const pending = deferred<LegacyHistoryResult>()
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  vi.mocked(bridge.restore).mockReturnValue(pending.promise)
  const { unmount, invalidation } = mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  unmount()
  await act(async () => pending.resolve(result))
  expect(invalidation).toHaveBeenCalledOnce()
  expect(refreshProfiles).toHaveBeenCalledOnce()
  expect(notify).not.toHaveBeenCalled()
})

it.each([null, connectionFor('remote')])(
  'does not inspect local records before a local connection is active',
  async connection => {
    $connection.set(connection)
    vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
    mount()
    await act(async () => {})
    expect(bridge.inspect).not.toHaveBeenCalled()
    expect(screen.queryByRole('region')).toBeNull()
  }
)

it('rechecks when the persisted 24-hour snooze expires without a restart', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  mount()
  const prompt = await card()
  vi.useFakeTimers()
  vi.mocked(bridge.remind).mockResolvedValue({
    ok: true,
    reminderKey: 'batch-a',
    showReminder: false,
    snoozedUntil: Date.now() + 86_400_000
  })
  fireEvent.click(within(prompt).getByRole('button', { name: '稍后再说' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.queryByRole('region')).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(86_400_000)
  })
  expect(bridge.inspect).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('region', { name: '发现未显示的本地聊天记录' })).toBeTruthy()
})

it('reuses a fresh inspection and refreshes a stale one on window focus', async () => {
  vi.mocked(bridge.inspect).mockResolvedValue(inspection({ owned: 2 }))
  mount()
  await card()
  vi.useFakeTimers({ toFake: ['Date'] })
  await act(async () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  expect(bridge.inspect).toHaveBeenCalledOnce()
  await act(async () => {
    focusManager.setFocused(false)
    vi.setSystemTime(Date.now() + 60_001)
    focusManager.setFocused(true)
  })
  await waitFor(() => expect(bridge.inspect).toHaveBeenCalledTimes(2))
})

it('does not suppress unowned records left after syncing verified records only', async () => {
  vi.mocked(bridge.inspect)
    .mockResolvedValueOnce(inspection({ owned: 2, unowned: 3 }))
    .mockResolvedValue(inspection({ planId: 'plan-b', reminderKey: 'batch-b', unowned: 3 }))
  mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '同步本地记录' }))
  await waitFor(() => expect(bridge.inspect).toHaveBeenCalledTimes(2))
  expect(bridge.restore).toHaveBeenCalledWith(expect.objectContaining({ includeUnowned: false }))
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  expect(screen.getByRole('checkbox', { name: '这些旧记录属于当前账号' })).toBeTruthy()
  expect(
    (within(screen.getByRole('dialog')).getByRole('button', { name: '同步本地记录' }) as HTMLButtonElement).disabled
  ).toBe(true)
})

it('finishes list refresh when a background inspection fails during sync', async () => {
  const pending = deferred<LegacyHistoryResult>()
  vi.mocked(bridge.inspect)
    .mockResolvedValueOnce(inspection({ owned: 2 }))
    .mockRejectedValueOnce(new Error('history_recovery_busy'))
    .mockResolvedValue(inspection({ showReminder: false }))
  vi.mocked(bridge.restore).mockReturnValue(pending.promise)
  const { client } = mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '同步本地记录' }))
  await act(async () => {
    await client.refetchQueries()
  })
  expect(screen.getByRole('region', { name: '发现未显示的本地聊天记录' })).toBeTruthy()
  await act(async () => pending.resolve(result))
  expect(invalidateProfileListFetches).toHaveBeenCalledOnce()
  expect(refreshProfiles).toHaveBeenCalledOnce()
  expect(invalidateProfileScopedQueries).toHaveBeenCalledOnce()
})

it('uses the reviewed inspection when a background refresh changes its plan', async () => {
  vi.mocked(bridge.inspect)
    .mockResolvedValueOnce(inspection({ unowned: 3 }))
    .mockResolvedValue(inspection({ planId: 'new-plan', unowned: 3 }))
  const { client } = mount()
  fireEvent.click(within(await card()).getByRole('button', { name: '忽略' }))
  await act(async () => {
    await client.refetchQueries()
  })
  fireEvent.click(screen.getByRole('button', { name: '确认忽略' }))
  await waitFor(() => expect(bridge.remind).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-a' })))
})
