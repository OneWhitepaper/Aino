import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getLatestSessionMessages } from '@/api/sessions'
import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { I18nProvider } from '@/i18n'
import * as gateway from '@/store/gateway'
import type { SessionOwnerScope } from '@/store/session-request-router'
import type { SessionMessagesResponse } from '@/types/hermes'

import { SubagentPanelTranscript } from './subagent-panel-transcript'

vi.mock('@/api/sessions', () => ({ getLatestSessionMessages: vi.fn() }))

const owner = { connectionId: 'remote-source', profile: 'research', targetProfile: 'server-research' }
const row: DelegateRow = { id: 'worker', goal: 'Review changes', sessionId: 'child', activity: [], status: 'completed' }
const clients: QueryClient[] = []
const request = vi.fn()

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
  vi.mocked(getLatestSessionMessages).mockReset().mockResolvedValue(transcript('**Verified result**'))
  request.mockReset().mockResolvedValue({ available: true, text: 'Live owned output', truncated: false })
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
  expect(request).not.toHaveBeenCalled()
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
  vi.mocked(getLatestSessionMessages).mockRejectedValueOnce(new Error('temporary read failure'))
  view.rerender(tree())
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('Verified result')
  expect(getLatestSessionMessages).toHaveBeenCalledTimes(2)
  expect(request).not.toHaveBeenCalled()
})

it('reuses the live tail with a captured owner and never duplicates it with REST polling', async () => {
  render(harness()({ live: true, row: { ...row, subagentId: 'native-worker', status: 'running' } }))
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Extended transcript'))
  await screen.findByText('Live owned output')
  expect(request).toHaveBeenCalledWith('remote-source', 'research', 'subagent.tail', {
    session_id: 'parent',
    subagent_id: 'native-worker'
  })
  fireEvent.click(screen.getByText('Extended transcript', { selector: 'summary' }))
  await waitFor(() => expect(screen.queryByText('Live owned output')).toBeNull())
  expect(getLatestSessionMessages).not.toHaveBeenCalled()
})
