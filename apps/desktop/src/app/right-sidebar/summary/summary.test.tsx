import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import { Activity } from '@/lib/icons'
import { $previewStatusBySession } from '@/store/preview-status'
import { $activeGatewayProfile } from '@/store/profile'
import { $projectTree } from '@/store/projects'
import { $activeSessionId, $connection, $selectedStoredSessionId, $sessions, $workspaceCwdOwner } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'
import type { SessionMessagesResponse } from '@/types/hermes'

import { SummarySection } from './summary-section'

import { SummaryPane } from './index'

beforeEach(() => {
  $projectTree.set([])
  $selectedStoredSessionId.set(null)
  $workspaceCwdOwner.set(null)
  $activeSessionId.set(null)
  $connection.set(null)
  $activeGatewayProfile.set('default')
  $previewStatusBySession.set({})
  $sessionStates.set({})
  $sessions.set([])
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

function renderSummary() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

  return render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <SummaryPane />
        </QueryClientProvider>
      </MemoryRouter>
    </I18nProvider>
  )
}

describe('SummaryPane', () => {
  it('shows output resources without generating a prose overview', async () => {
    const api = vi.fn(async (_request: { path: string }) => ({
      session_id: 'summary-cited',
      messages: [{ role: 'assistant', content: '[Report](/work/report.pdf)' }]
    }))

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    $sessions.set([makeSessionInfo({ id: 'summary-cited', profile: 'default', connection_id: 'local' })])
    $selectedStoredSessionId.set('summary-cited')
    renderSummary()

    expect(await screen.findByRole('button', { name: '打开来源: report.pdf' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '输出内容' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '会话概览' })).toBeNull()
    expect(api.mock.calls.some(([request]) => request.path.includes('/summary?'))).toBe(false)
  })

  it('treats an unsent runtime as a draft and starts reading history after the first send', async () => {
    const api = vi.fn(async (request: { path: string }) => {
      throw new Error(`Session has no persisted messages: ${request.path}`)
    })

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    const state = { ...createClientSessionState('new-draft'), isUnsentDraft: true }
    $sessions.set([makeSessionInfo({ id: 'new-draft', profile: 'default', connection_id: 'local' })])
    $sessionStates.set({ 'draft-runtime': state })
    $selectedStoredSessionId.set('new-draft')
    $activeSessionId.set('draft-runtime')
    renderSummary()
    await act(async () => {})
    expect(screen.queryByText('暂时无法读取此会话的历史记录')).toBeNull()
    expect(screen.getByRole('button', { name: '创建文件或网页' })).toBeTruthy()
    expect(api).not.toHaveBeenCalled()

    act(() => $sessionStates.set({ 'draft-runtime': { ...state, isUnsentDraft: false } }))
    expect(await screen.findByText('暂时无法读取此会话的历史记录')).toBeTruthy()
    expect(api.mock.calls.filter(([request]) => request.path.includes('/messages?'))).toHaveLength(1)
  })

  it('keeps ordinary chat compact and only reveals resources belonging to its runtime and durable history', async () => {
    renderSummary()

    expect(screen.getByRole('complementary', { name: '会话资源' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '会话资源' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '创建文件或网页' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '环境信息' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '来源' })).toBeNull()

    const api = vi.fn(async (_request: { path: string }) => ({
      session_id: 'summary-a',
      messages: [
        { role: 'user', content: 'Read @file:/work/reference.md' },
        {
          role: 'tool',
          tool_name: 'document_export',
          content: JSON.stringify({ output_path: '/work/report.pdf' })
        },
        { role: 'assistant', content: '[Report](/work/report.pdf)' }
      ]
    }))

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    const state = createClientSessionState('summary-a')

    act(() => {
      $sessions.set([makeSessionInfo({ id: 'summary-a', profile: 'default', connection_id: 'local' })])
      $sessionStates.set({ 'runtime-a': state })
      $activeSessionId.set('runtime-a')
      $selectedStoredSessionId.set('summary-a')
      $previewStatusBySession.set({
        'runtime-a': [
          { id: 'site', cwd: '/work', generated: true, label: 'Live site', target: '/work/index.html' },
          { id: 'reference', cwd: '/work', label: 'Live reference', target: '/work/reference.html' }
        ],
        'summary-a': [{ id: 'wrong-id', cwd: '/work', label: 'Wrong stored-id feed', target: '/work/other.html' }]
      })
    })

    expect(await screen.findByRole('button', { name: '打开来源: report.pdf' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开来源: Live site' })).toBeTruthy()
    expect(screen.queryByText('Wrong stored-id feed')).toBeNull()
    const sourceSection = screen.getByRole('heading', { name: '来源' }).closest('section')!
    expect(within(sourceSection).getByRole('button', { name: '打开来源: reference.md' })).toBeTruthy()
    expect(within(sourceSection).getByRole('button', { name: '打开来源: Live reference' })).toBeTruthy()
    expect(within(sourceSection).queryByText('report.pdf')).toBeNull()

    let transcriptReads = 0

    const streamingMessages = new Proxy<typeof state.messages>(
      [{ id: 'streaming', role: 'assistant', parts: [{ type: 'text', text: 'delta' }] }],
      {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) {
            transcriptReads += 1
          }

          return Reflect.get(target, key, receiver)
        }
      }
    )

    act(() =>
      $sessionStates.set({
        'runtime-a': {
          ...state,
          messages: streamingMessages
        }
      })
    )
    expect(api.mock.calls.filter(([request]) => request.path.includes('/messages?'))).toHaveLength(1)
    expect(transcriptReads).toBe(0)
  })

  it('discards another conversation’s late history and runtime feeds while routing the new history to its owner', async () => {
    let finishOld!: (value: SessionMessagesResponse) => void

    const oldResponse = new Promise<SessionMessagesResponse>(resolve => {
      finishOld = resolve
    })

    const api = vi.fn((request: { path: string }) =>
      request.path.includes('summary-a')
        ? oldResponse
        : Promise.resolve({
            session_id: 'summary-b',
            messages: [{ role: 'assistant', content: '[New report](/work/new.pdf)' }]
          })
    )

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    $sessions.set([
      makeSessionInfo({ id: 'summary-a', profile: 'default', connection_id: 'local' }),
      makeSessionInfo({ id: 'summary-b', profile: 'work' })
    ])
    $sessionStates.set({ 'runtime-a': createClientSessionState('summary-a') })
    $selectedStoredSessionId.set('summary-a')
    $activeSessionId.set('runtime-a')
    $previewStatusBySession.set({
      'runtime-a': [{ id: 'old-preview', cwd: '/old', label: 'Old preview', target: '/old/index.html' }]
    })
    renderSummary()
    await waitFor(() =>
      expect(api.mock.calls.filter(([request]) => request.path.includes('/messages?'))).toHaveLength(1)
    )

    act(() => {
      $selectedStoredSessionId.set('summary-b')
      $activeGatewayProfile.set('work')
      $connection.set({
        baseUrl: 'http://unused.invalid',
        connectionId: 'different-remote',
        isFullscreen: false,
        mode: 'remote',
        nativeOverlayWidth: 0,
        profile: 'work',
        token: '',
        wsUrl: '',
        logs: [],
        windowButtonPosition: null
      })
    })
    expect(await screen.findByText('new.pdf')).toBeTruthy()
    await act(async () =>
      finishOld({ session_id: 'summary-a', messages: [{ role: 'assistant', content: '[Old report](/old/old.pdf)' }] })
    )

    expect(screen.queryByText('old.pdf')).toBeNull()
    expect(screen.queryByText('Old preview')).toBeNull()
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'local',
        profile: 'work',
        path: expect.stringContaining('/summary-b/messages?profile=work')
      })
    )

    // Multiple possible backends require proven ownership; an unlisted id
    // must not silently query whichever profile happens to be active.
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api, connections: { list: vi.fn() } }
    const calls = api.mock.calls.length
    act(() => $selectedStoredSessionId.set('summary-unknown-owner'))
    expect(await screen.findByText('暂时无法读取此会话的历史记录')).toBeTruthy()
    expect(screen.queryByText('new.pdf')).toBeNull()
    expect(api).toHaveBeenCalledTimes(calls)
  })
})

describe('SummarySection', () => {
  it('shows an error retry action without replacing the whole pane', () => {
    const retry = vi.fn()

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <SummarySection error="不可用" icon={Activity} onRetry={retry} state="error" title="系统资源">
          <span>不会显示在错误态中</span>
        </SummarySection>
      </I18nProvider>
    )

    expect(screen.getByText('不可用')).toBeTruthy()
    expect(screen.queryByText('不会显示在错误态中')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
