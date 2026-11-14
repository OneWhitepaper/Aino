import { AssistantRuntimeProvider, type ThreadMessage } from '@assistant-ui/react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'
import { $activeSessionId, $busy, $turnStartedAt } from '@/store/session'

import { assistantMessage, stubThreadEnvironment, userMessage } from '../test-utils'

import { Thread } from '.'

function Transcript({ messages }: { messages: ThreadMessage[] }) {
  const messageRepository = useMemo(
    () => ({
      headId: messages.at(-1)?.id ?? null,
      messages: messages.map((message, index) => ({ message, parentId: messages[index - 1]?.id ?? null }))
    }),
    [messages]
  )

  const runtime = useIncrementalExternalStoreRuntime({ messageRepository, isRunning: true, onNew: async () => {} })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

beforeEach(() => {
  stubThreadEnvironment()
  $activeSessionId.set('status-motion')
  $turnStartedAt.set(Date.now())
  $busy.set(true)
})

afterEach(() => {
  cleanup()
  $activeSessionId.set(null)
  $turnStartedAt.set(null)
  $busy.set(false)
  vi.restoreAllMocks()
})

it('keeps a waiting row still while earlier content streams behind a trailing system notice', async () => {
  const animate = vi.spyOn(Element.prototype, 'animate')
  const prompt = userMessage('motion-request', 'Check the requirements.')

  const notice = {
    id: 'motion-notice',
    role: 'system',
    content: [{ type: 'text', text: 'Self-improvement review' }],
    createdAt: prompt.createdAt,
    metadata: { custom: {} }
  } as ThreadMessage

  const response = { ...assistantMessage(), id: 'motion-response', status: { type: 'running' } } as ThreadMessage
  const { container, rerender } = render(<Transcript messages={[prompt, response, notice]} />)
  const waitingRow = container.querySelector('[data-slot="aui_response-loading"]')
  expect(waitingRow).toBeTruthy()

  const waitingRoot = waitingRow!.closest('[data-slot="aui_assistant-message-root"]')
  expect(animate.mock.contexts.filter(element => element === waitingRoot)).toHaveLength(0)

  for (const text of ['Checking requirements.', 'Checking requirements. Checking the next source.']) {
    rerender(<Transcript messages={[prompt, { ...response, content: [{ type: 'text', text }] }, notice]} />)
    await waitFor(() => expect(container.textContent).toContain(text))
    expect(container.querySelector('[data-slot="aui_response-loading"]')).toBe(waitingRow)
    expect(animate.mock.contexts.filter(element => element === waitingRoot)).toHaveLength(0)
  }
})

it('preserves the entrance animation for a running response that already has visible content', () => {
  const animate = vi.spyOn(Element.prototype, 'animate')

  const { container } = render(
    <Transcript messages={[userMessage(), { ...assistantMessage(), status: { type: 'running' } } as ThreadMessage]} />
  )

  const root = container.querySelector('[data-slot="aui_assistant-message-root"]')
  expect(animate.mock.contexts.filter(element => element === root)).toHaveLength(1)
})
