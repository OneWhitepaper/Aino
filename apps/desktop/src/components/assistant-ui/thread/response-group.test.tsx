import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import * as toolPresentation from '@/components/assistant-ui/tool/fallback-model'
import { toChatMessages } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import type { SessionMessage } from '@/types/hermes'

import { assistantMessage, stubThreadEnvironment, ThreadRuntime, userMessage } from '../test-utils'

import { AssistantMessageParts } from './message-parts'
import { ResponseMessages } from './response-group'

import { Thread } from '.'

beforeEach(stubThreadEnvironment)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('does not rederive historical tool outcomes for streamed tokens but exposes updated failures', async () => {
  const outcome = vi.spyOn(toolPresentation, 'toolPreviewOutcome')

  const part = {
    type: 'tool-call' as const,
    toolCallId: 'completed-read',
    toolName: 'read_file',
    args: { path: '/repo/large.txt' },
    argsText: '{"path":"/repo/large.txt"}',
    result: JSON.stringify({ content: 'historical result '.repeat(10000) })
  }

  const history = {
    ...assistantMessage(),
    id: 'historical-answer',
    content: [part, { type: 'text', text: 'Read complete.', displayPhase: 'final' }]
  } as ThreadMessage

  const components = { AssistantMessage: AssistantMessageParts, UserMessage: () => null }
  const indices = [1]
  const prompt = userMessage('historical-prompt', 'Read the file.')
  const nextPrompt = userMessage('next-prompt', 'Explain it.')

  const frame = (text: string, older = history) => (
    <ThreadRuntime
      messages={[
        prompt,
        older,
        nextPrompt,
        { ...assistantMessage(), id: 'live-answer', content: [{ type: 'text', text }], status: { type: 'running' } }
      ]}
    >
      <ResponseMessages components={components} indices={indices} />
    </ThreadRuntime>
  )

  const { container, rerender } = render(frame('one'))
  const initialDerivations = outcome.mock.calls.length
  expect(initialDerivations).toBeGreaterThan(0)
  expect(container.querySelector('[data-slot="aui_response-process-header"]')).not.toBeNull()

  for (const text of ['one two', 'one two three', 'one two three four']) {
    rerender(frame(text))
  }

  expect(outcome).toHaveBeenCalledTimes(initialDerivations)

  // GroupedParts also rescans when text in the tool's own message grows,
  // and assistant-ui supplies fresh status-bearing wrappers for that scan.
  rerender(
    frame('one two three four', {
      ...history,
      content: [{ ...part }, { type: 'text', text: 'Read complete. More detail.', displayPhase: 'final' }]
    } as ThreadMessage)
  )
  expect(outcome).toHaveBeenCalledTimes(initialDerivations)

  rerender(
    frame('one two three four', {
      ...history,
      content: [{ ...part, isError: true }, history.content[1]]
    } as ThreadMessage)
  )
  await waitFor(() => expect(container.querySelector('[data-slot="aui_response-process-header"]')).toBeNull())
  expect(outcome.mock.calls.length).toBeGreaterThan(initialDerivations)
})

it('keeps background continuations in one response with one action bar and the original message identities', async () => {
  const content = '[IMPORTANT: Background process proc_example completed normally (exit code 0).\nOutput:\nVerified.]'
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
  vi.stubGlobal('navigator', { ...navigator, clipboard })
  const branch = vi.fn()

  for (const display of [
    {},
    { display_kind: 'process_complete', display_metadata: { display_text: 'Background Process Finished: verify' } },
    { display_kind: 'async_delegation_complete', display_metadata: { display_text: 'Background agent finished' } }
  ]) {
    const stored = [
      { role: 'user', content: 'Verify it.', timestamp: 1 },
      { role: 'assistant', content: 'Checking the deployment.', timestamp: 2 },
      { role: 'user', content, timestamp: 3, ...display },
      { role: 'assistant', content: 'The deployment is verified.', timestamp: 4 }
    ] as SessionMessage[]

    const messages = toChatMessages(stored).map(toRuntimeMessage)

    const { container, rerender, unmount } = render(
      <ThreadRuntime messages={messages.slice(0, 2)}>
        <Thread onBranchInNewChat={branch} />
      </ThreadRuntime>
    )

    const original = container.querySelector('[data-role="assistant"]')

    rerender(
      <ThreadRuntime messages={messages}>
        <Thread onBranchInNewChat={branch} />
      </ThreadRuntime>
    )
    await waitFor(() => expect(container.textContent).toContain('The deployment is verified.'))
    expect(container.querySelectorAll('[data-slot="aui_turn-pair"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="aui_response-group"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="aui_msg-actions"]')).toHaveLength(1)
    expect(container.querySelector('[data-role="assistant"]')).toBe(original)
    expect(
      [...container.querySelectorAll('[data-role="assistant"]')].map(e => e.getAttribute('data-message-id'))
    ).toEqual([messages[1]!.id, messages[3]!.id])
    const actions = container.querySelector('[data-slot="aui_msg-actions"]') as HTMLElement
    fireEvent.click(within(actions).getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenLastCalledWith('Checking the deployment.\n\nThe deployment is verified.')
    )
    fireEvent.click(within(actions).getByRole('button', { name: /branch/i }))
    expect(branch).toHaveBeenLastCalledWith(messages[3]!.id)

    const pending: ThreadMessage[] = [
      ...messages,
      { ...messages[3]!, role: 'assistant', id: 'next', content: [], status: { type: 'running' } } as ThreadMessage
    ]

    rerender(
      <ThreadRuntime messages={pending}>
        <Thread onBranchInNewChat={branch} />
      </ThreadRuntime>
    )
    await waitFor(() => expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(3))
    expect(container.querySelectorAll('[data-slot="aui_msg-actions"]')).toHaveLength(1)

    unmount()

    const reloaded = render(
      <ThreadRuntime messages={messages}>
        <Thread />
      </ThreadRuntime>
    )

    expect(reloaded.container.querySelectorAll('[data-slot="aui_msg-actions"]')).toHaveLength(1)
    reloaded.unmount()
  }
})

it('ends the response at a real user prompt or unrelated system event', () => {
  const messages = toChatMessages([
    { role: 'user', content: 'First question', timestamp: 1 },
    { role: 'assistant', content: 'First answer', timestamp: 2 },
    { role: 'system', content: 'slash:/model\nmodel changed', timestamp: 3 },
    { role: 'assistant', content: 'Separate answer', timestamp: 4 },
    { role: 'user', content: 'Second question', timestamp: 5 },
    { role: 'assistant', content: 'Second answer', timestamp: 6 }
  ]).map(toRuntimeMessage)

  const { container } = render(
    <ThreadRuntime messages={messages}>
      <Thread />
    </ThreadRuntime>
  )

  expect(container.querySelectorAll('[data-slot="aui_turn-pair"]')).toHaveLength(2)
  expect(container.querySelectorAll('[data-slot="aui_msg-actions"]')).toHaveLength(3)
})
