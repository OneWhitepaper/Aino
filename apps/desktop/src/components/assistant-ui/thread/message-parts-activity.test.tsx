import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { toChatMessages } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import { $reasoningCollapsedByDefault, setShowReasoningFromConfig } from '@/store/reasoning-disclosure'
import { $toolDisclosureStates } from '@/store/tool-view'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()

const thought = (text: string) => ({ type: 'reasoning', text })

const read = (id: string) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'read_file',
  args: { path: `/repo/${id}.ts` },
  argsText: JSON.stringify({ path: `/repo/${id}.ts` }),
  result: { content: `contents of ${id}` }
})

function message(content: unknown[], running = false): ThreadMessage {
  return {
    ...assistantMessage(),
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' }
  } as ThreadMessage
}

function Transcript({ value }: { value: ThreadMessage }) {
  return (
    <ThreadRuntime messages={[value]}>
      <Thread />
    </ThreadRuntime>
  )
}

describe('conversation activity presentation', () => {
  beforeEach(() => {
    $toolDisclosureStates.set({})
    $reasoningCollapsedByDefault.set(true)
    setShowReasoningFromConfig(true)
  })

  afterEach(cleanup)

  it.each([
    ['delegate_task', { goal: 'Review sources' }],
    ['react_to_message', { emoji: '👍' }],
    ['terminal', { command: 'hermes -p reviewer chat -q "Message from assistant: review sources"' }]
  ])('keeps a stored %s failure visible instead of showing a successful notice', (name, args) => {
    const messages = toChatMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'failed-notice', function: { name, arguments: JSON.stringify(args) } }]
      },
      { role: 'tool', tool_call_id: 'failed-notice', content: JSON.stringify({ error: 'Provider unavailable' }) }
    ]).map(toRuntimeMessage)

    const { container } = render(
      <ThreadRuntime messages={messages}>
        <Thread />
      </ThreadRuntime>
    )

    const failure = within(container).getByLabelText('Error')
    expect(failure.closest('[hidden]')).toBeNull()
    fireEvent.click(failure.closest('button')!)
    expect(within(container).getByText('Provider unavailable').closest('[hidden]')).toBeNull()
    expect(container.querySelector('[data-slot="delegate-detail"]')).toBeNull()
  })

  it.each([false, true])(
    'keeps reasoning choice (%s) independent as tool runs and public findings arrive',
    async reasoningOpen => {
      const progress = { type: 'text', text: 'I am checking the implementation.', displayPhase: 'commentary' }
      const finding = { type: 'text', text: 'The first implementation uses the shared renderer.' }
      const firstThought = thought('First private thought.')
      const initial = message([progress, firstThought], true)
      // An old aggregate toggle must not become permission to expose raw reasoning.
      $toolDisclosureStates.set({ [`process:${initial.id}:1`]: true })
      const { container, rerender } = render(<Transcript value={initial} />)
      const firstReasoning = container.querySelector('[data-slot="aui_thinking-disclosure"]') as HTMLElement
      const reasoningToggle = within(firstReasoning).getByRole('button')
      expect(reasoningToggle.getAttribute('aria-expanded')).toBe('false')
      expect(container.textContent).not.toContain(firstThought.text)
      fireEvent.click(reasoningToggle)

      if (!reasoningOpen) {
        fireEvent.click(reasoningToggle)
      }

      const cycles = [
        firstThought,
        read('first-a'),
        read('first-b'),
        thought('Second private thought.'),
        read('second-a'),
        read('second-b')
      ]

      rerender(<Transcript value={message([progress, ...cycles], true)} />)
      await waitFor(() => expect(container.querySelectorAll('[data-tool-summary]')).toHaveLength(2))
      const summaries = [...container.querySelectorAll<HTMLElement>('[data-tool-summary]')]
      const thinking = [...container.querySelectorAll<HTMLElement>('[data-slot="aui_thinking-disclosure"]')]
      expect(thinking).toHaveLength(2)
      expect(thinking[0]).toBe(firstReasoning)
      expect(reasoningToggle.getAttribute('aria-expanded')).toBe(String(reasoningOpen))
      expect(container.textContent?.includes(firstThought.text)).toBe(reasoningOpen)
      expect(container.textContent).not.toContain('Second private thought.')

      const firstRunToggle = within(summaries[0]).getByRole('button')
      const secondRunToggle = within(summaries[1]).getByRole('button')
      fireEvent.click(firstRunToggle)
      expect(within(container).getByRole('button', { name: 'Read first-a.ts' })).not.toBeNull()
      expect(within(container).queryByRole('button', { name: 'Read second-a.ts' })).toBeNull()
      expect(secondRunToggle.getAttribute('aria-expanded')).toBe('false')
      expect(container.textContent).not.toContain('Second private thought.')
      expect(reasoningToggle.getAttribute('aria-expanded')).toBe(String(reasoningOpen))
      expect(within(container).getByText(progress.text).closest('[hidden]')).toBeNull()

      fireEvent.click(within(thinking[1]).getByRole('button'))
      expect(container.textContent).toContain('Second private thought.')
      expect(secondRunToggle.getAttribute('aria-expanded')).toBe('false')
      const body = thinking[1].querySelector('[data-slot="aui_thinking-body"]') as HTMLElement
      expect(body.className).toContain('max-h-80')
      expect(body.className).toContain('overflow-auto')
      expect(body.className).toContain('overscroll-y-auto')

      rerender(<Transcript value={message([progress, ...cycles, finding])} />)
      await waitFor(() => expect(firstReasoning.getAttribute('data-pending')).toBe('false'))
      expect(reasoningToggle.getAttribute('aria-expanded')).toBe(String(reasoningOpen))
      expect(firstRunToggle.getAttribute('aria-expanded')).toBe('true')
      expect(secondRunToggle.getAttribute('aria-expanded')).toBe('false')
      const findingText = within(container).getByText(finding.text)
      expect(findingText.closest('[hidden]')).toBeNull()
      expect(
        within(container).getByText(progress.text).compareDocumentPosition(summaries[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(summaries[1].compareDocumentPosition(findingText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  )

  it('keeps failures, user questions and generated outputs outside the collapsed process', () => {
    const failedRead = { ...read('failed'), isError: true, result: { error: 'Permission denied' } }

    const question = {
      type: 'tool-call',
      toolCallId: 'question',
      toolName: 'clarify',
      args: { question: 'Which license should I compare?' },
      argsText: '{}',
      result: { question: 'Which license should I compare?', answer: 'MIT' }
    }

    const output = {
      type: 'tool-call',
      toolCallId: 'output',
      toolName: 'image_generate',
      args: {},
      argsText: '{}',
      result: { image: 'https://cdn.example/comparison.png' }
    }

    const { container } = render(
      <Transcript
        value={message([
          thought('First private thought.'),
          read('first'),
          failedRead,
          thought('Second private thought.'),
          read('second'),
          question,
          output,
          { type: 'text', text: 'Here is the comparison.' }
        ])}
      />
    )

    expect(container.textContent).not.toContain('private thought')
    const failure = within(container).getByLabelText('Error')
    expect(failure.closest('[data-slot="aui_thinking-disclosure"]')).toBeNull()
    fireEvent.click(failure.closest('button')!)
    expect(container.textContent).toContain('Permission denied')
    const questionText = within(container).getByText('Which license should I compare?')
    expect(questionText.closest('[data-slot="aui_thinking-disclosure"]')).toBeNull()
    const generated = within(container).getByRole('img', { name: 'Generated image' })
    expect(generated.closest('[data-slot="aui_thinking-disclosure"]')).toBeNull()
    expect(container.textContent).toContain('Here is the comparison.')
  })
})
