import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { summaryOutputs } from '@/app/right-sidebar/summary/session-content'
import type { ChatMessage } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import { $previewStatusBySession } from '@/store/preview-status'
import { $activeSessionId, $currentCwd, $messages } from '@/store/session'
import { $toolDisclosureStates } from '@/store/tool-view'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

stubThreadEnvironment()
stubThreadViewportSize()

afterEach(() => {
  cleanup()
  $previewStatusBySession.set({})
  $toolDisclosureStates.set({})
  $activeSessionId.set(null)
  $currentCwd.set('')
  $messages.set([])
})

it('registers a successful HTML output when a mixed live run completes without opening its summary', async () => {
  const sessionId = 'collapsed-preview-session'
  const target = '/work/generated.html'

  const pending: ChatMessage = {
    id: 'collapsed-preview-message',
    role: 'assistant',
    pending: true,
    parts: [
      {
        type: 'tool-call',
        toolCallId: 'read-source',
        toolName: 'read_file',
        args: { path: '/work/reference.html' },
        result: { content: '<main>Reference</main>' }
      },
      {
        type: 'tool-call',
        toolCallId: 'write-output',
        toolName: 'write_file',
        args: { path: target, content: '<main>Output</main>' }
      }
    ]
  }

  const completed: ChatMessage = {
    ...pending,
    pending: false,
    parts: pending.parts.map(part =>
      part.type === 'tool-call' && part.toolCallId === 'write-output'
        ? { ...part, result: { success: true, path: target } }
        : part
    )
  }

  const transcript = (message: ChatMessage) => (
    <ThreadRuntime messages={[toRuntimeMessage(message)]}>
      <Thread />
    </ThreadRuntime>
  )

  $activeSessionId.set(sessionId)
  $currentCwd.set('/work')
  $messages.set([pending])
  $toolDisclosureStates.set({})
  const { container, rerender } = render(transcript(pending))
  expect($previewStatusBySession.get()[sessionId]).toBeUndefined()

  $messages.set([completed])
  rerender(transcript(completed))

  await waitFor(() => {
    expect(summaryOutputs([], [], $previewStatusBySession.get()[sessionId] ?? []).map(item => item.target)).toEqual([
      target
    ])
  })
  const toggle = container.querySelector('[data-tool-summary] button[aria-expanded]')
  expect(toggle?.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[data-tool-row], [data-tool-run-details]')).toBeNull()
  expect($previewStatusBySession.get()[sessionId]?.[0]?.cwd).toBe('/work')
  expect($previewStatusBySession.get()[sessionId]?.[0]?.generated).toBe(true)
})
