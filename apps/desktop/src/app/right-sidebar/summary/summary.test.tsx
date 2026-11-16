import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onComposerFocusRequest, onComposerInsertRequest, onComposerSubmitRequest } from '@/app/chat/composer/focus'
import { $workspaceMode, $workspaceOwnerLabels } from '@/components/pane-shell/workspace-scope'
import { I18nProvider } from '@/i18n'
import { createClientSessionState } from '@/lib/chat-runtime'
import { Activity } from '@/lib/icons'
import { $botChatScopes } from '@/store/bot-chat-scope'
import { $previewTabs } from '@/store/preview'
import { $previewStatusBySession } from '@/store/preview-status'
import { $activeGatewayProfile } from '@/store/profile'
import { $projectTree } from '@/store/projects'
import { $activeSessionId, $connection, $selectedStoredSessionId, $sessions, $workspaceCwdOwner } from '@/store/session'
import { $sessionStates } from '@/store/session-states'
import { $summaryOpen } from '@/store/summary'
import { $toolSession } from '@/store/tool-session'
import { stubMenuDomApis } from '@/test/jsdom'
import { makeSessionInfo } from '@/test/session-info'
import type { SessionMessagesResponse } from '@/types/hermes'

import { OutputsSection } from './outputs-section'
import { SummarySection } from './summary-section'

import { SummaryPane } from './index'

beforeEach(() => {
  $workspaceMode.set('sessions')
  $projectTree.set([])
  $selectedStoredSessionId.set(null)
  $workspaceCwdOwner.set(null)
  $activeSessionId.set(null)
  $connection.set(null)
  $activeGatewayProfile.set('default')
  $previewStatusBySession.set({})
  $sessionStates.set({})
  $sessions.set([])
  $summaryOpen.set(false)
  $botChatScopes.set({})
  $workspaceOwnerLabels.set({})
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

function renderSummary(content = <SummaryPane />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 60_000 } }
  })

  return render(
    <I18nProvider configClient={null} initialLocale="zh">
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
      </MemoryRouter>
    </I18nProvider>
  )
}

describe('SummaryPane', () => {
  it('keeps the reviewed Bot output and source sections visible with honest empty state and scoped creation', async () => {
    $workspaceMode.set('bots')
    const insert = vi.fn()
    const focus = vi.fn()
    const stopInsert = onComposerInsertRequest(insert)
    const stopFocus = onComposerFocusRequest(focus)

    try {
      renderSummary()
      expect(screen.getByText('本次会话的产物、任务和执行记录集中在这里。')).toBeTruthy()
      expect(screen.getByRole('heading', { name: '输出内容' })).toBeTruthy()
      expect(screen.getByText('本次会话还没有生成文件。')).toBeTruthy()
      expect(screen.getByRole('heading', { name: '来源' })).toBeTruthy()
      expect(screen.getByText('添加文件或网页后显示在这里。')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '创建文件或网页' }))
      await waitFor(() =>
        expect(insert).toHaveBeenCalledWith({ mode: 'block', target: 'main', text: '帮我创建文件或网页：' })
      )
      fireEvent.click(screen.getByRole('button', { name: '添加来源' }))
      expect(focus).toHaveBeenLastCalledWith({ target: 'main', typeChar: '@' })
    } finally {
      stopInsert()
      stopFocus()
    }
  })

  it('shows the owning conversation title and closes without changing the selected conversation', () => {
    $sessions.set([makeSessionInfo({ id: 'summary-title', title: 'Browser review', connection_id: 'local' })])
    $selectedStoredSessionId.set('summary-title')
    $summaryOpen.set(true)
    renderSummary()

    expect(screen.getByText('Browser review')).toBeTruthy()
    stubMenuDomApis()
    fireEvent.pointerDown(screen.getByRole('button', { name: '操作' }), { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: '收起会话摘要' }))
    expect($summaryOpen.get()).toBe(false)
    expect($selectedStoredSessionId.get()).toBe('summary-title')
  })

  it('uses the current Bot name for its canonical relationship chat without changing its stored title', () => {
    $sessions.set([makeSessionInfo({ id: 'bot-summary', title: 'Bot Chat', connection_id: 'local' })])
    $selectedStoredSessionId.set('bot-summary')
    $botChatScopes.set({
      'bot-summary': { workspaceMode: 'bots', workspaceOwnerKey: 'bot-owner', workspaceTabTitle: 'Bot Chat' }
    })
    $workspaceOwnerLabels.set({ 'bot-owner': 'Research assistant' })
    renderSummary()

    expect(screen.getByText('Research assistant')).toBeTruthy()
    expect(screen.queryByText('Bot Chat')).toBeNull()
    act(() => $workspaceOwnerLabels.set({ 'bot-owner': 'Documentation assistant' }))
    expect(screen.getByText('Documentation assistant')).toBeTruthy()
    expect($sessions.get()[0]?.title).toBe('Bot Chat')
  })

  it('keeps creation available beside existing outputs and addresses an editable draft to its owning composer', async () => {
    const insert = vi.fn()
    const focus = vi.fn()
    const submit = vi.fn()

    const subscriptions = [
      onComposerInsertRequest(insert),
      onComposerFocusRequest(focus),
      onComposerSubmitRequest(submit)
    ]

    try {
      renderSummary(
        <OutputsSection
          error={null}
          items={[{ id: 'report', kind: 'file', label: 'report.pdf', target: '/work/report.pdf' }]}
          loading={false}
          onRetry={vi.fn()}
          session={{ ...$toolSession.get(), target: 'tile:output-owner' }}
          showEmpty
        />
      )

      expect(screen.getByRole('button', { name: '打开来源: report.pdf' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '创建文件或网页' }))

      await waitFor(() => {
        expect(insert).toHaveBeenCalledExactlyOnceWith({
          mode: 'block',
          target: 'tile:output-owner',
          text: '帮我创建文件或网页：'
        })
        expect(focus).toHaveBeenCalledExactlyOnceWith({ target: 'tile:output-owner', typeChar: undefined })
      })
      expect(submit).not.toHaveBeenCalled()
    } finally {
      subscriptions.forEach(unsubscribe => unsubscribe())
    }
  })

  it('expands and collapses sources while opening them in the owning preview without promoting them to outputs', async () => {
    const sources = Array.from({ length: 6 }, (_, index) => `https://example.com/reference-${index + 1}`)

    const api = vi.fn(async (_request: { path: string }) => ({
      session_id: 'summary-resources',
      messages: [
        { role: 'user', content: sources.join('\n') },
        { role: 'tool', tool_name: 'document_export', content: JSON.stringify({ output_path: '/work/report.pdf' }) },
        { role: 'assistant', content: '[Report](/work/report.pdf)' }
      ]
    }))

    const previousTabs = $previewTabs.get()

    try {
      ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
      $sessions.set([makeSessionInfo({ id: 'summary-resources', profile: 'default', connection_id: 'local' })])
      $selectedStoredSessionId.set('summary-resources')
      $sessionStates.set({ 'resource-runtime': createClientSessionState('summary-resources') })
      $activeSessionId.set('resource-runtime')
      renderSummary()

      const section = (await screen.findByRole('heading', { name: '来源' })).closest('section')!
      const list = within(section)
      const output = within(screen.getByRole('heading', { name: /^输出内容/ }).closest('section')!)
      const expand = await list.findByRole('button', { name: '查看全部（6）' })
      expect(expand.getAttribute('aria-expanded')).toBe('false')
      expect(list.queryByRole('button', { name: `打开来源: ${sources[5]}` })).toBeNull()
      fireEvent.click(expand)
      const collapse = list.getByRole('button', { name: '收起' })
      expect(collapse.getAttribute('aria-expanded')).toBe('true')
      fireEvent.click(list.getByRole('button', { name: `打开来源: ${sources[5]}` }))

      await waitFor(() => {
        expect($previewTabs.get()).toContainEqual(
          expect.objectContaining({
            sessionId: 'summary-resources',
            target: expect.objectContaining({ kind: 'url', source: sources[5], url: sources[5] })
          })
        )
      })
      expect(output.getByRole('button', { name: '打开来源: report.pdf' })).toBeTruthy()
      expect(output.queryByRole('button', { name: `打开来源: ${sources[5]}` })).toBeNull()
      fireEvent.click(collapse)
      expect(list.getByRole('button', { name: '查看全部（6）' }).getAttribute('aria-expanded')).toBe('false')
      expect(list.queryByRole('button', { name: `打开来源: ${sources[5]}` })).toBeNull()
      expect(list.getByRole('button', { name: `打开来源: ${sources[0]}` })).toBeTruthy()
      expect(api.mock.calls.filter(([request]) => request.path.includes('/messages?'))).toHaveLength(1)
    } finally {
      act(() => $previewTabs.set(previousTabs))
    }
  })

  it('shows output resources without generating a prose overview', async () => {
    const api = vi.fn(async (_request: { path: string }) => ({
      session_id: 'summary-cited',
      messages: [
        { role: 'tool', tool_name: 'document_export', content: JSON.stringify({ output_path: '/work/report.pdf' }) },
        { role: 'assistant', content: '[Report](/work/report.pdf)' }
      ]
    }))

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    $sessions.set([makeSessionInfo({ id: 'summary-cited', profile: 'default', connection_id: 'local' })])
    $selectedStoredSessionId.set('summary-cited')
    renderSummary()

    expect(await screen.findByRole('button', { name: '打开来源: report.pdf' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^输出内容/ })).toBeTruthy()
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

  it('refreshes persisted outputs when a turn completes inside the shared cache freshness window', async () => {
    const source = 'https://example.com/completed-turn'
    let messages: SessionMessagesResponse['messages'] = []

    const api = vi.fn(async (_request: { path: string }) => ({ session_id: 'summary-refresh', messages }))

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }
    const state = createClientSessionState('summary-refresh')
    $sessions.set([makeSessionInfo({ id: 'summary-refresh', profile: 'default', connection_id: 'local' })])
    $selectedStoredSessionId.set('summary-refresh')
    $sessionStates.set({ 'refresh-runtime': state })
    $activeSessionId.set('refresh-runtime')
    renderSummary()

    await waitFor(() => expect(screen.queryByRole('heading', { name: /^输出内容/ })).toBeNull())
    expect(screen.getByRole('button', { name: '创建文件或网页' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '来源' })).toBeNull()
    expect(screen.queryByText('添加文件或网页后显示在这里。')).toBeNull()

    messages = [{ role: 'user', content: source }]
    act(() => $sessionStates.set({ 'refresh-runtime': { ...state, busy: true } }))
    expect(await screen.findByRole('button', { name: `打开来源: ${source}` })).toBeTruthy()

    messages = [...messages, { role: 'assistant', content: 'MEDIA:/work/completed-report.md' }]
    act(() => $sessionStates.set({ 'refresh-runtime': { ...state, busy: false } }))

    expect(await screen.findByRole('button', { name: '打开来源: completed-report.md' })).toBeTruthy()
    expect(screen.getByRole('button', { name: `打开来源: ${source}` })).toBeTruthy()
    expect(api.mock.calls.filter(([request]) => request.path.includes('/messages?'))).toHaveLength(3)
  })

  it('keeps ordinary chat compact and only reveals resources belonging to its runtime and durable history', async () => {
    renderSummary()

    expect(screen.getByRole('complementary', { name: '会话摘要' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '会话摘要' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '创建文件或网页' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '环境信息' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '来源' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /^输出内容/ })).toBeNull()
    expect(screen.queryByText('添加文件或网页后显示在这里。')).toBeNull()

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

  it('keeps source creation discoverable in the summary menu when its empty section is omitted', () => {
    const focus = vi.fn()
    const unsubscribe = onComposerFocusRequest(focus)

    try {
      renderSummary()
      expect(screen.queryByRole('heading', { name: '来源' })).toBeNull()
      stubMenuDomApis()
      fireEvent.pointerDown(screen.getByRole('button', { name: '操作' }), { button: 0, ctrlKey: false })
      fireEvent.click(screen.getByRole('menuitem', { name: '添加来源' }))
      expect(focus).toHaveBeenCalledWith({ target: 'main', typeChar: '@' })
    } finally {
      unsubscribe()
    }
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
