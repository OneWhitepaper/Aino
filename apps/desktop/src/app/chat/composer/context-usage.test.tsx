import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { I18nProvider } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $compactingSessions, setSessionCompacting } from '@/store/compaction'
import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import { stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'
import type { ContextBreakdown } from '@/types/hermes'

import { ComposerContextUsage } from './context-usage'

const breakdown: ContextBreakdown = {
  categories: [{ id: 'conversation', label: 'Conversation', color: 'teal', tokens: 80_000 }],
  context_estimated: true,
  context_max: 100_000,
  context_percent: 80,
  context_used: 80_000,
  estimated_total: 80_000
}

beforeAll(stubResizeObserver)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  $sessionStates.set({})
  $compactingSessions.set({})
})

describe('composer context usage', () => {
  it('uses the current account catalog for a cold managed session without binding or inventing occupancy', async () => {
    const sessionId = 'cold-managed'
    const originalBridge = window.hermesDesktop
    const snapshot = platformSnapshot()
    let capacity = 100_000

    const platformSelection = {
      modelId: 'catalog-a',
      ownerUserId: 'user-a',
      platformOrigin: 'https://platform.test',
      status: 'awaiting_managed_credentials' as const
    }

    const bind = vi.fn()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: { status: async () => snapshot, capabilities: async () => ({}), onChanged: () => () => {} },
        platformModels: {
          list: async () => [
            { ...platformModel(), context_window: capacity },
            { ...platformModel('catalog-b'), context_window: 300_000 }
          ],
          owner: async () => ({ user_id: 'user-a', platform_origin: 'https://platform.test' }),
          bind
        }
      }
    })

    try {
      await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

      const view = {
        ...PRIMARY_SESSION_VIEW,
        $runtimeId: atom<string | null>(sessionId),
        $busy: atom(false),
        $model: atom('catalog-a'),
        $provider: atom('aino')
      }

      const previousUsage = {
        calls: 1,
        input: 0,
        output: 0,
        total: 0,
        context_used: 12_000,
        context_max: 1_000_000,
        context_percent: 1
      }

      $sessionStates.set({
        [sessionId]: { ...createClientSessionState(sessionId), platformModel: platformSelection, usage: previousUsage }
      })

      const requestGateway = vi.fn().mockResolvedValue({
        ...breakdown,
        categories: [],
        context_max: 0,
        context_used: 12_000,
        context_percent: 0,
        context_estimated: false
      })

      render(
        <I18nProvider configClient={null} initialLocale="zh">
          <SessionViewProvider value={view}>
            <ComposerContextUsage enabled requestGateway={requestGateway} />
          </SessionViewProvider>
        </I18nProvider>
      )
      await screen.findByRole('button', { name: '上下文用量 · 已用 12%' })
      capacity = 200_000
      await act(() => platformModelCatalog().load())
      await screen.findByRole('button', { name: '上下文用量 · 已用 6%' })
      act(() => {
        view.$model.set('catalog-b')
        $sessionStates.set({
          [sessionId]: {
            ...$sessionStates.get()[sessionId],
            platformModel: { ...platformSelection, modelId: 'catalog-b' }
          }
        })
      })
      await screen.findByRole('button', { name: '上下文用量 · 已用 4%' })
      expect(bind).not.toHaveBeenCalled()

      // Once bound, the runtime's capacity owns the live meter even when the
      // public catalog still advertises a different window.
      act(() =>
        $sessionStates.set({
          [sessionId]: {
            ...$sessionStates.get()[sessionId],
            platformModel: { ...platformSelection, modelId: 'catalog-b', status: 'ready' },
            usage: { ...previousUsage, context_max: 400_000, context_percent: 3 }
          }
        })
      )
      await screen.findByRole('button', { name: '上下文用量 · 已用 3%' })

      // Only capacity is known for this runtime: the RPC's required zero fields
      // are an unknown placeholder, not a provider measurement of 0%.
      requestGateway.mockResolvedValue({
        categories: [],
        context_max: 0,
        context_used: 0,
        context_percent: 0,
        estimated_total: 0,
        context_source: 'unknown'
      })
      act(() => {
        $sessionStates.set({
          [sessionId]: { ...$sessionStates.get()[sessionId], usage: { calls: 0, input: 0, output: 0, total: 0 } }
        })
      })
      await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull())
      expect(screen.queryByRole('button', { name: /已用 0%/ })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /上下文用量/ }))
      const details = screen.getByRole('dialog', { name: '上下文用量' })
      expect(within(details).getByText(/— \/ 300k/)).toBeTruthy()
      act(() =>
        $sessionStates.set({
          [sessionId]: {
            ...$sessionStates.get()[sessionId],
            platformModel: { ...platformSelection, modelId: 'catalog-b', ownerUserId: 'different-account' }
          }
        })
      )
      expect(within(details).queryByText(/300k/)).toBeNull()
      expect(bind).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalBridge })
    }
  })

  it('keeps known context tokens and details when the model capacity is unavailable', async () => {
    const sessionId = 'unknown-capacity'
    const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: atom<string | null>(sessionId), $busy: atom(false) }
    const requestGateway = vi.fn().mockResolvedValue({ ...breakdown, context_max: 0, context_percent: 0 })
    $sessionStates.set({
      [sessionId]: {
        ...createClientSessionState(sessionId),
        usage: { calls: 0, input: 0, output: 0, total: 0, context_max: 0, context_percent: 0, context_used: 0 }
      }
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <SessionViewProvider value={view}>
          <ComposerContextUsage enabled requestGateway={requestGateway} />
        </SessionViewProvider>
      </I18nProvider>
    )

    const button = await screen.findByRole('button', { name: /上下文用量 · ~80k \/ —/ })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
    fireEvent.click(button)
    const panel = screen.getByRole('dialog', { name: '上下文用量' })
    expect(within(panel).getByText('对话')).toBeTruthy()
    expect(within(panel).queryByText('暂无上下文数据')).toBeNull()
    expect(within(panel).queryByText('已用 0%')).toBeNull()
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('uses catalog capacity when a cold Aino resume omitted platform metadata', async () => {
    const originalBridge = window.hermesDesktop
    const snapshot = platformSnapshot()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: { status: async () => snapshot, capabilities: async () => ({}), onChanged: () => () => {} },
        platformModels: {
          list: async () => [platformModel()],
          owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
        }
      }
    })

    try {
      await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
      const sessionId = 'cold-missing-status'

      const view = {
        ...PRIMARY_SESSION_VIEW,
        $runtimeId: atom<string | null>(sessionId),
        $busy: atom(false),
        $model: atom('catalog-a'),
        $provider: atom('aino')
      }

      $sessionStates.set({
        [sessionId]: {
          ...createClientSessionState(sessionId),
          usage: { calls: 0, input: 0, output: 0, total: 0, context_used: 12_000, context_source: 'unknown' }
        }
      })

      const requestGateway = vi.fn().mockResolvedValue({
        categories: [],
        context_max: 0,
        context_percent: 0,
        context_source: 'unknown',
        context_used: 0,
        estimated_total: 0
      })

      render(
        <I18nProvider configClient={null} initialLocale="zh">
          <SessionViewProvider value={view}>
            <ComposerContextUsage enabled requestGateway={requestGateway} />
          </SessionViewProvider>
        </I18nProvider>
      )
      await screen.findByRole('button', { name: '上下文用量 · — / 10k 个词元' })
      expect(screen.queryByRole('button', { name: /已用 0%/ })).toBeNull()
    } finally {
      Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalBridge })
    }
  })

  it('does not restart exhausted initialization on hover or focus, but retries when opened', async () => {
    vi.useFakeTimers()
    const sessionId = 'cold-session'
    const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: atom<string | null>(sessionId), $busy: atom(false) }

    const requestGateway = vi.fn().mockResolvedValue({
      categories: [],
      context_max: 0,
      context_percent: 0,
      context_used: 0,
      estimated_total: 0
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <SessionViewProvider value={view}>
          <ComposerContextUsage enabled requestGateway={requestGateway} />
        </SessionViewProvider>
      </I18nProvider>
    )
    await act(() => vi.runAllTimersAsync())
    const button = screen.getByRole('button', { name: '上下文用量 · 暂无上下文数据' })
    const exhaustedCalls = requestGateway.mock.calls.length
    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    fireEvent.focus(button)
    await act(() => vi.runAllTimersAsync())
    expect(requestGateway).toHaveBeenCalledTimes(exhaustedCalls)

    requestGateway.mockResolvedValue({ ...breakdown, categories: [] })
    await act(async () => fireEvent.click(button))
    expect(screen.getByRole('button', { name: '上下文用量 · ~已用 80%' })).toBeTruthy()
    expect(within(screen.getByRole('dialog')).queryByText('暂无上下文数据')).toBeNull()
    expect(requestGateway).toHaveBeenCalledTimes(exhaustedCalls + 1)
  })

  it('uses this composer session and keeps the ring, hover hint and details on the same measured usage', async () => {
    const sessionId = 'tile-runtime'
    const runtime = atom<string | null>(sessionId)
    const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: runtime, $busy: atom(false) }
    const requestGateway = vi.fn().mockResolvedValue(breakdown)

    const usage = {
      calls: 1,
      input: 0,
      output: 0,
      total: 0,
      context_estimated: false,
      context_used: 10_000,
      context_max: 100_000,
      context_percent: 10
    }

    $sessionStates.set({
      [sessionId]: { ...createClientSessionState('tile-stored'), usage },
      'other-runtime': { ...createClientSessionState('other-stored'), usage: { ...usage, context_percent: 90 } }
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <SessionViewProvider value={view}>
          <ComposerContextUsage enabled requestGateway={requestGateway} />
        </SessionViewProvider>
      </I18nProvider>
    )

    const button = screen.getByRole('button', { name: '上下文用量 · 已用 10%' })
    await waitFor(() =>
      expect(requestGateway).toHaveBeenCalledWith('session.context_breakdown', { session_id: sessionId })
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('10')
    fireEvent.pointerMove(button, { pointerType: 'mouse' })
    const hint = await screen.findByRole('tooltip')
    expect(hint.textContent).toContain('已用 10%')
    expect(hint.textContent).toContain('10k / 100k')
    fireEvent.click(button)

    const dialog = screen.getByRole('dialog', { name: '上下文用量' })
    expect(within(dialog).getByText('已用 10%')).toBeTruthy()
    expect(within(dialog).getByText('对话')).toBeTruthy()
    act(() =>
      $sessionStates.set({
        ...$sessionStates.get(),
        [sessionId]: {
          ...$sessionStates.get()[sessionId],
          usage: { ...usage, context_used: 40_000, context_percent: 40 }
        }
      })
    )
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40')
    expect(within(dialog).getByText('已用 40%')).toBeTruthy()
    expect(requestGateway).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(button.ownerDocument, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('drops the previous owner data and skips estimates while compaction runs', async () => {
    const sessionId = 'runtime'

    const view = {
      ...PRIMARY_SESSION_VIEW,
      $runtimeId: atom<string | null>(sessionId),
      $busy: atom(false),
      $model: atom('first-model')
    }

    const firstOwner = vi.fn().mockResolvedValue(breakdown)
    let resolvePrevious!: (value: ContextBreakdown) => void

    const secondOwner = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolvePrevious = resolve
          })
      )
      .mockResolvedValue({ ...breakdown, context_used: 20_000, context_percent: 20 })

    const content = (requestGateway: typeof firstOwner) => (
      <I18nProvider configClient={null} initialLocale="zh">
        <SessionViewProvider value={view}>
          <ComposerContextUsage enabled requestGateway={requestGateway} />
        </SessionViewProvider>
      </I18nProvider>
    )

    const { rerender } = render(content(firstOwner))
    await screen.findByRole('button', { name: '上下文用量 · ~已用 80%' })

    rerender(content(secondOwner))
    expect(screen.getByRole('button', { name: '上下文用量 · 正在加载明细…' })).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
    act(() => setSessionCompacting(sessionId, true))
    expect(screen.getByRole('button', { name: '上下文用量 · 正在压缩上下文…' })).toBeTruthy()
    await act(async () => resolvePrevious(breakdown))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
    expect(secondOwner).toHaveBeenCalledTimes(1)

    act(() => setSessionCompacting(sessionId, false))
    await screen.findByRole('button', { name: '上下文用量 · ~已用 20%' })
    expect(secondOwner).toHaveBeenCalledTimes(2)

    // Model changes and a renewed capacity for the SAME model both invalidate
    // the old breakdown before the replacement response arrives.
    for (const change of [
      () => view.$model.set('replacement-model'),
      () =>
        $sessionStates.set({
          [sessionId]: {
            ...createClientSessionState('stored'),
            usage: { calls: 0, input: 0, output: 0, total: 0, context_max: 372_000 }
          }
        })
    ]) {
      let resolveFresh!: (value: ContextBreakdown) => void
      secondOwner.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFresh = resolve
          })
      )
      act(change)
      expect(screen.queryByRole('button', { name: /已用 20%/ })).toBeNull()
      await act(async () =>
        resolveFresh({ ...breakdown, context_max: 372_000, context_used: 74_400, context_percent: 20 })
      )
      expect(screen.getByRole('button', { name: '上下文用量 · ~已用 20%' })).toBeTruthy()
    }

    expect(secondOwner).toHaveBeenCalledTimes(4)
    act(() => view.$runtimeId.set('new-runtime'))
    expect(screen.queryByRole('button', { name: /已用 20%/ })).toBeNull()
  })
})
