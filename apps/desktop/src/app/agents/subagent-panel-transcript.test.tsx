import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getLatestSessionMessages } from '@/api/sessions'
import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { I18nProvider } from '@/i18n'
import * as gateway from '@/store/gateway'
import { $notificationEpoch } from '@/store/notifications'
import type { SessionOwnerScope } from '@/store/session-request-router'
import type { SessionMessagesResponse } from '@/types/hermes'

import { SubagentPanelTranscript } from './subagent-panel-transcript'

vi.mock('@/api/sessions', () => ({ getLatestSessionMessages: vi.fn() }))

const owner = { connectionId: 'remote-source', profile: 'research', targetProfile: 'server-research' }
const row: DelegateRow = { id: 'worker', goal: 'Review changes', sessionId: 'child', activity: [], status: 'completed' }
const clients: QueryClient[] = []
const request = vi.fn()

function childPage(text: string, next: string | null = null, rowId = 1) {
  return {
    session_id: 'parent', subagent_id: 'native-worker', available: true, running: false,
    child_session_id: 'stored-child', next_cursor: next, reset: false,
    rows: [{ row_kind: 'message', role: 'assistant', text, row_id: rowId }]
  }
}

function transcript(text: string): SessionMessagesResponse {
  return {
    session_id: 'child',
    messages: [
      { role: 'assistant', content: text },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'tool', type: 'function', function: { name: 'read_file', arguments: '{"path":"/work/report.md"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'tool', tool_name: 'read_file', content: '{"opaque":"not a readable transcript"}' }
    ]
  }
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)

  return (options: { row?: DelegateRow; owner?: SessionOwnerScope; visible?: boolean; live?: boolean } = {}) => (
    <QueryClientProvider client={client}>
      <I18nProvider configClient={null} initialLocale="en">
        <PaneVisibleContext.Provider value={options.visible ?? true}>
          <SubagentPanelTranscript
            live={options.live ?? false}
            owner={Object.hasOwn(options, 'owner') ? options.owner : owner}
            parentRuntimeId="parent"
            row={options.row ?? row}
          />
        </PaneVisibleContext.Provider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  $notificationEpoch.set(0)
  vi.mocked(getLatestSessionMessages).mockReset().mockResolvedValue(transcript('**Verified result**'))
  request.mockReset().mockImplementation((_connection, _profile, method) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: [] } : { available: true, text: 'Live owned output', truncated: false }))
  vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation(request)
})

afterEach(() => {
  cleanup()

  for (const client of clients.splice(0)) {
    client.clear()
  }

  vi.restoreAllMocks()
})

it('reads a settled child with its exact REST source and renders normalized content rather than tool JSON', async () => {
  render(harness()())
  expect(await screen.findByText('Verified result')).toBeInstanceOf(HTMLElement)
  expect(getLatestSessionMessages).toHaveBeenCalledWith(
    'child',
    { connectionId: 'remote-source', profile: 'server-research' },
    { passive: true }
  )
  expect(screen.queryByText(/not a readable transcript/)).toBeNull()
  expect(request.mock.calls.map(call => call[2])).toEqual(['runtime.describe'])
})

it('does not repeat the task instructions already displayed in the detail header', async () => {
  const response = transcript('Final result')
  response.messages.unshift({ role: 'user', content: row.goal })
  vi.mocked(getLatestSessionMessages).mockResolvedValue(response)
  render(harness()())
  await screen.findByText('Final result')
  expect(screen.queryByText(row.goal)).toBeNull()
})

it('does not load a hidden tab, and a late response cannot enter another child or owner view', async () => {
  let resolveOld!: (response: SessionMessagesResponse) => void
  vi.mocked(getLatestSessionMessages).mockReturnValueOnce(new Promise(resolve => (resolveOld = resolve)))
  const tree = harness()
  const view = render(tree({ visible: false }))
  await act(async () => undefined)
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
  view.rerender(tree())
  await waitFor(() => expect(getLatestSessionMessages).toHaveBeenCalledTimes(1))
  view.rerender(
    tree({ row: { ...row, sessionId: 'other-child' }, owner: { connectionId: 'other-source', profile: 'research' } })
  )
  await screen.findByText('Verified result')
  await act(async () => resolveOld(transcript('Old source output')))
  expect(screen.queryByText('Old source output')).toBeNull()
  expect(getLatestSessionMessages).toHaveBeenLastCalledWith(
    'other-child',
    { connectionId: 'other-source', profile: 'research' },
    { passive: true }
  )
})

it('fails closed without an owner, and lets a visible failed read retry without activating a session', async () => {
  const tree = harness()
  const view = render(tree({ owner: null }))
  expect(screen.getByText('Live transcript unavailable')).toBeTruthy()
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
  expect(request).not.toHaveBeenCalled()
  vi.mocked(getLatestSessionMessages).mockRejectedValueOnce(new Error('temporary read failure'))
  view.rerender(tree())
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('Verified result')
  expect(getLatestSessionMessages).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.map(call => call[2])).toEqual(['runtime.describe'])
})

it('reuses the live tail with a captured owner and never duplicates it with REST polling', async () => {
  render(harness()({ live: true, row: { ...row, subagentId: 'native-worker', status: 'running' } }))
  expect(request.mock.calls.some(call => call[2] === 'subagent.tail')).toBe(false)
  fireEvent.click(await screen.findByText('Extended transcript'))
  await screen.findByText('Live owned output')
  expect(request).toHaveBeenCalledWith('remote-source', 'research', 'subagent.tail', {
    session_id: 'parent',
    subagent_id: 'native-worker'
  })
  fireEvent.click(screen.getByText('Extended transcript', { selector: 'summary' }))
  await waitFor(() => expect(screen.queryByText('Live owned output')).toBeNull())
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
})

it('reads canonical child rows through the captured parent even before the child session id arrives', async () => {
  request.mockImplementation((_connection, _profile, method) => Promise.resolve(
    method === 'runtime.describe' ? { capabilities: ['session-transcript-v1'] } : childPage('Canonical child answer')
  ))
  render(harness()({ row: { ...row, sessionId: undefined, subagentId: 'native-worker' } }))
  expect(await screen.findByText('Canonical child answer')).toBeTruthy()
  expect(request).toHaveBeenCalledWith('remote-source', 'research', 'session.transcript', expect.objectContaining({
    session_id: 'parent', subagent_id: 'native-worker', order: 'latest'
  }), undefined, expect.any(AbortSignal))
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
  expect(request.mock.calls.some(call => ['subagent.tail', 'session.resume'].includes(call[2]))).toBe(false)
})

it('loads earlier canonical rows with the owner-issued child cursor and keeps chronological order', async () => {
  request.mockImplementation((_connection, _profile, method, params) => Promise.resolve(
    method === 'runtime.describe' ? { capabilities: ['session-transcript-v1'] }
      : params.cursor ? childPage('Earlier child answer', null, 1) : childPage('Latest child answer', 'older-child-cursor', 2)
  ))
  render(harness()({ row: { ...row, subagentId: 'native-worker' } }))
  await screen.findByText('Latest child answer')
  fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }))
  await screen.findByText('Earlier child answer')
  const content = window.document.querySelector('[data-slot="subagent-panel-transcript"]')!.textContent!
  expect(content.indexOf('Earlier child answer')).toBeLessThan(content.indexOf('Latest child answer'))
  expect(request).toHaveBeenLastCalledWith('remote-source', 'research', 'session.transcript', expect.objectContaining({
    session_id: 'parent', subagent_id: 'native-worker', cursor: 'older-child-cursor'
  }), undefined, expect.any(AbortSignal))
})

it.each(['runtime.describe', 'session.transcript'])('does not downgrade a temporary %s failure to REST or tail', async failed => {
  let healthy = false
  request.mockImplementation((_connection, _profile, method) => {
    if (!healthy && method === failed) { return Promise.reject(new Error('temporary owner failure')) }

    return Promise.resolve(method === 'runtime.describe'
      ? { capabilities: ['session-transcript-v1'] } : childPage('Recovered child answer'))
  })
  render(harness()({ live: true, row: { ...row, subagentId: 'native-worker', status: 'running' } }))
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
  expect(request.mock.calls.some(call => call[2] === 'subagent.tail')).toBe(false)
  healthy = true
  fireEvent.click(retry)
  await screen.findByText('Recovered child answer')
})

it('falls back only when the exact owner proves runtime.describe is unavailable', async () => {
  request.mockRejectedValue(Object.assign(new Error('Method not found'), { code: -32601 }))
  render(harness()())
  await screen.findByText('Verified result')
  expect(getLatestSessionMessages).toHaveBeenCalledWith('child', {
    connectionId: 'remote-source', profile: 'server-research'
  }, { passive: true })
  expect(request.mock.calls.map(call => call[2])).toEqual(['runtime.describe'])
})

it('does not negotiate or poll while hidden, and resumes the owned read when shown', async () => {
  request.mockImplementation((_connection, _profile, method) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] } : childPage('Visible canonical answer')))
  const tree = harness()
  const view = render(tree({ visible: false, live: true }))
  await act(async () => undefined)
  expect(request).not.toHaveBeenCalled()
  view.rerender(tree({ live: true }))
  await screen.findByText('Visible canonical answer')
  view.rerender(tree({ visible: false, live: true }))
  const calls = request.mock.calls.length
  await act(() => new Promise(resolve => setTimeout(resolve, 2100)))
  expect(request).toHaveBeenCalledTimes(calls)
  expect(screen.queryByText('Visible canonical answer')).toBeNull()
})

it('fences late canonical results when the account changes while keeping the same parent and owner', async () => {
  let resolveOld!: (value: ReturnType<typeof childPage>) => void
  let calls = 0
  request.mockImplementation((_connection, _profile, method) => {
    if (method === 'runtime.describe') { return Promise.resolve({ capabilities: ['session-transcript-v1'] }) }

    return ++calls === 1 ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(childPage('New account answer'))
  })
  render(harness()())
  await waitFor(() => expect(calls).toBe(1))
  act(() => $notificationEpoch.set(1))
  await screen.findByText('New account answer')
  await act(async () => resolveOld(childPage('Previous account private answer')))
  expect(screen.queryByText('Previous account private answer')).toBeNull()
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
})

it('keeps a read-only running child current, then stops polling when the owner reports completion', async () => {
  let polls = 0
  request.mockImplementation((_connection, _profile, method) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] }
    : { ...childPage(++polls === 1 ? 'Read-only first step' : 'Read-only final step'), running: polls === 1 }))
  render(harness()({ live: false, row: { ...row, status: 'running' } }))
  await screen.findByText('Read-only first step')
  await waitFor(() => expect(screen.getByText('Read-only final step')).toBeTruthy(), { timeout: 3000 })
  await act(() => new Promise(resolve => setTimeout(resolve, 2100)))
  expect(polls).toBe(2)
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
})

it('replaces held pages when a cursor crosses a lineage reset instead of mixing generations', async () => {
  request.mockImplementation((_connection, _profile, method, params) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] }
    : params.cursor ? { ...childPage('New lineage latest', 'new-lineage-cursor', 3), reset: true }
      : childPage('Previous lineage tail', 'previous-lineage-cursor', 2)))
  render(harness()())
  await screen.findByText('Previous lineage tail')
  fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }))
  await screen.findByText('New lineage latest')
  expect(screen.queryByText('Previous lineage tail')).toBeNull()
})

it.each(['queued', 'running', 'dispatched'] as const)('shows an active %s child waiting for its first output', async status => {
  request.mockImplementation((_connection, _profile, method) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] }
    : { ...childPage(''), rows: [], running: true }))
  render(harness()({ row: { ...row, status } }))
  expect(await screen.findByRole('status', { name: 'Running' })).toBeTruthy()
  expect(screen.queryByText('Live transcript unavailable')).toBeNull()
})

it.each(['queued', 'running', 'dispatched'] as const)('honors terminal empty output over a stale %s roster row', async status => {
  request.mockImplementation((_connection, _profile, method) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] }
    : { ...childPage(''), rows: [], running: false }))
  render(harness()({ row: { ...row, status } }))
  expect(await screen.findByText('Live transcript unavailable')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Running' })).toBeNull()
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
})

it('shows running for an empty live backend, but unavailable for an empty settled child', async () => {
  request.mockImplementation((_connection, _profile, method, params) => Promise.resolve(method === 'runtime.describe'
    ? { capabilities: ['session-transcript-v1'] }
    : { ...childPage(''), rows: [], running: params.subagent_id === 'live-worker' }))
  const tree = harness()
  const view = render(tree({ row: { ...row, subagentId: 'live-worker' } }))
  expect(await screen.findByRole('status', { name: 'Running' })).toBeTruthy()
  expect(screen.queryByText('Live transcript unavailable')).toBeNull()
  view.rerender(tree({ row: { ...row, subagentId: 'settled-worker' } }))
  expect(await screen.findByText('Live transcript unavailable')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Running' })).toBeNull()
})
