import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { $busy } from '@/store/session'

import { assistantMessage, stubThreadEnvironment, userMessage } from '../test-utils'

import { Thread } from '.'

beforeEach(stubThreadEnvironment)
afterEach(() => {
  cleanup()
  $busy.set(false)
})

function answer(id: string, running = false): Extract<ThreadMessage, { role: 'assistant' }> {
  return {
    ...assistantMessage(),
    role: 'assistant',
    id,
    content: [{ type: 'text', text: id }],
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' }
  } as Extract<ThreadMessage, { role: 'assistant' }>
}

function Harness({
  messages,
  running = false,
  historical = false
}: {
  messages: ThreadMessage[]
  running?: boolean
  historical?: boolean
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    isRunning: running,
    isDisabled: historical,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread onBranchInNewChat={() => undefined} />
    </AssistantRuntimeProvider>
  )
}

it('reveals response actions only after both streaming and the turn finish, preserving earlier actions', async () => {
  const history = [userMessage('old-user'), answer('old-answer'), userMessage('new-user')]
  $busy.set(true)
  const { container, rerender } = render(<Harness messages={[...history, answer('new-answer', true)]} running />)
  const previous = container.querySelector('[data-message-id="old-answer"]') as HTMLElement
  const current = container.querySelector('[data-message-id="new-answer"]') as HTMLElement
  const previousActions = within(previous).getByRole('button', { name: 'Copy' })
  expect(within(current).queryByRole('button', { name: 'Copy' })).toBeNull()

  // A sealed text bubble is not a finished turn: tools and provider waits follow it.
  rerender(<Harness messages={[...history, answer('new-answer')]} running />)
  expect(within(current).queryByRole('button', { name: 'Copy' })).toBeNull()

  const tool: ThreadMessage = {
    ...answer('tool', true),
    content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read_file', args: {}, argsText: '{}' }]
  }

  rerender(<Harness messages={[...history, answer('new-answer'), tool, userMessage('queued')]} running />)
  expect(within(current).queryByRole('button', { name: 'Copy' })).toBeNull()
  expect(within(previous).getByRole('button', { name: 'Copy' })).toBe(previousActions)

  // Either ordering of the two completion signals must keep unfinished actions hidden.
  act(() => $busy.set(false))
  rerender(<Harness messages={[...history, answer('new-answer', true)]} />)
  expect(within(current).queryByRole('button', { name: 'Copy' })).toBeNull()
  rerender(<Harness messages={[...history, answer('new-answer')]} />)
  await waitFor(() => expect(within(current).getByRole('button', { name: 'Copy' })).toBeTruthy())
  expect(container.querySelector('[data-slot="aui_turn-activity"]')).toBeNull()
  expect(within(previous).getByRole('button', { name: 'Copy' })).toBe(previousActions)
})

it('keeps background continuations pending without hiding idle or historical views', async () => {
  const busy = atom(true)
  const view = { ...PRIMARY_SESSION_VIEW, $busy: busy }

  const messages = [
    userMessage(),
    answer('current-answer'),
    userMessage(
      'background',
      '[IMPORTANT: Background process proc_test completed normally (exit code 0).\nOutput:\nReady.]'
    )
  ]

  const { container, rerender } = render(
    <SessionViewProvider value={view}>
      <Harness messages={messages} running />
    </SessionViewProvider>
  )

  const current = container.querySelector('[data-message-id="current-answer"]') as HTMLElement
  expect(within(current).queryByRole('button', { name: 'Copy' })).toBeNull()
  act(() => {
    $busy.set(true)
    busy.set(false)
  })
  rerender(
    <SessionViewProvider value={view}>
      <Harness messages={messages} />
    </SessionViewProvider>
  )
  await waitFor(() => expect(within(current).getByRole('button', { name: 'Copy' })).toBeTruthy())
  act(() => busy.set(true))
  rerender(
    <SessionViewProvider value={view}>
      <Harness historical messages={messages} />
    </SessionViewProvider>
  )
  expect(within(current).getByRole('button', { name: 'Copy' })).toBeTruthy()
})
