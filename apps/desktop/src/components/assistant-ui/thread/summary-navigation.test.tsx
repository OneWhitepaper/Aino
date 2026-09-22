import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  backfillOlderTranscriptPage,
  mergeOlderTranscriptPage,
  transcriptBackfillAvailable
} from '@/app/chat/transcript-backfill'
import { selectTranscriptWindow } from '@/app/chat/transcript-window'
import { revealSummaryMessage } from '@/app/right-sidebar/summary/message-navigation'
import { PaneVisibleContext } from '@/components/pane-shell/pane-visibility'
import { toChatMessages } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import type * as ToolSessionModule from '@/store/tool-session'
import { $transcriptTailBySessionId, recordTranscriptTail } from '@/store/transcript-tail'
import type { SessionMessage } from '@/types/hermes'

import { TranscriptWindowProvider } from './transcript-window'

import { Thread } from '.'

const state = vi.hoisted(() => ({
  session: {
    target: 'main',
    storedId: 'stored',
    runtimeId: 'runtime',
    sourceKey: 'source',
    cwd: '',
    owner: 'default',
    scope: { profile: 'default', connectionId: 'local' },
    busy: false
  }
}))

vi.mock('@/store/tool-session', async importOriginal => {
  const actual = await importOriginal<typeof ToolSessionModule>()
  const { atom } = await import('nanostores')

  return {
    ...actual,
    $toolSession: atom(state.session),
    toolSessionIsCurrent: (session: typeof state.session) => state.session === session
  }
})

const rows = Array.from({ length: 120 }, (_, i): SessionMessage => ({
  id: 1000 + i,
  role: 'user',
  content: `tail ${i}`,
  timestamp: 1000 + i
}))

const toolRows: SessionMessage[] = [
  { id: 1, role: 'user', content: 'Earlier question', timestamp: 1 },
  {
    id: 2,
    role: 'assistant',
    content: '',
    timestamp: 2,
    tool_calls: [{ id: 'call', type: 'function', function: { name: 'terminal', arguments: '{"command":"pwd"}' } }]
  },
  { id: 3, role: 'tool', tool_call_id: 'call', content: '/project', timestamp: 3 },
  { id: 4, role: 'assistant', content: 'Earlier answer', timestamp: 4 },
  {
    id: 5,
    role: 'assistant',
    content: 'Inspecting',
    timestamp: 5,
    tool_calls: [{ id: 'second-call', type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } }]
  },
  { id: 6, role: 'tool', tool_call_id: 'second-call', content: 'README.md', timestamp: 6 },
  { id: 7, role: 'assistant', content: 'Done inspecting', timestamp: 7 }
]

function Harness({ sessionId = 'runtime', visible = true }: { sessionId?: string; visible?: boolean }) {
  const current = useRef(sessionId)
  current.current = sessionId
  const [messages, setMessages] = useState(() => toChatMessages(rows))
  const [pages, setPages] = useState(1)
  useStore($transcriptTailBySessionId)
  const selected = selectTranscriptWindow(messages, pages)

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: selected.messages.map(toRuntimeMessage),
    isRunning: false,
    onNew: async () => {}
  })

  const expandWindow = async (beforePrepend?: () => void) => {
    if (!selected.windowed && transcriptBackfillAvailable('stored')) {
      const applied = await backfillOlderTranscriptPage({
        storedSessionId: 'stored',
        isCurrent: () => current.current === sessionId,
        applyOlderPage: page => {
          beforePrepend?.()
          setMessages(existing => mergeOlderTranscriptPage(existing, page))
        }
      })

      if (!applied) {
        return false
      }
    } else {
      beforePrepend?.()
    }

    setPages(value => value + 1)

    return true
  }

  return (
    <div data-chat-surface="" data-session-anchor="workspace">
      <PaneVisibleContext.Provider value={visible}>
        <TranscriptWindowProvider
          value={{ olderAvailable: selected.windowed || transcriptBackfillAvailable('stored'), expandWindow }}
        >
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread sessionId={sessionId} sessionKey={sessionId} />
          </AssistantRuntimeProvider>
        </TranscriptWindowProvider>
      </PaneVisibleContext.Provider>
    </div>
  )
}

const api = vi.fn()
const scrollIntoView = vi.fn()
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  Element.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() }) as unknown as Animation
  window.hermesDesktop = { api } as unknown as typeof window.hermesDesktop
  api.mockReset()
  scrollIntoView.mockClear()
  $transcriptTailBySessionId.set({})
  recordTranscriptTail('stored', {
    messages: rows,
    pagination: { limit: 120, offset: 0, order: 'latest', returned: 120 }
  })
})
afterEach(() => cleanup())

it('reveals a folded tool citation in main after a slow real REST backfill, without touching a hidden duplicate', async () => {
  api.mockImplementation(async ({ path }: { path: string }) => {
    await new Promise(resolve => setTimeout(resolve, 650))
    const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset'))

    const messages =
      offset === 120
        ? rows.map(row => ({ ...row, id: Number(row.id) - 500, timestamp: Number(row.timestamp) - 500 }))
        : toolRows

    return {
      session_id: 'stored',
      messages,
      pagination: { limit: 120, offset, order: 'latest', returned: messages.length }
    }
  })

  const { container } = render(
    <>
      <div data-pane-hidden="">
        <div data-chat-surface="" data-session-anchor="workspace">
          <div data-durable-row-id="3" />
        </div>
      </div>
      <Harness />
    </>
  )

  let result: Promise<boolean>
  act(() => {
    result = revealSummaryMessage(state.session, 3)
  })
  await waitFor(() => expect(container.querySelector('[data-source-row-ids~="3"]')).not.toBeNull())
  expect(await result!).toBe(true)
  expect(container.querySelector('[data-source-row-ids~="6"]')).toBe(
    container.querySelector('[data-source-row-ids~="3"]')
  )
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('offset=120') }))
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('offset=240') }))
  expect(scrollIntoView).toHaveBeenCalledTimes(1)
  expect(scrollIntoView.mock.instances[0]).toBe(container.querySelector('[data-source-row-ids~="3"]'))
})

it('cancels a pending real backfill when the mounted thread switches session', async () => {
  let resolvePage!: (value: unknown) => void
  api.mockImplementation(
    () =>
      new Promise(resolve => {
        resolvePage = resolve
      })
  )
  const { rerender, container } = render(<Harness />)
  let result: Promise<boolean>
  act(() => {
    result = revealSummaryMessage(state.session, 3)
  })
  await waitFor(() => expect(api).toHaveBeenCalled())
  rerender(<Harness sessionId="other-runtime" />)
  expect(await result!).toBe(false)
  await act(async () => {
    resolvePage({ session_id: 'stored', messages: toolRows })
    await Promise.resolve()
  })
  expect(container.querySelector('[data-source-row-ids~="3"]')).toBeNull()
  expect(scrollIntoView).not.toHaveBeenCalled()
})
