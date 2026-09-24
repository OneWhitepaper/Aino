import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { toChatMessages } from '@/lib/chat-messages'
import { toRuntimeMessage } from '@/lib/chat-runtime'
import { $toolDisclosureStates } from '@/store/tool-view'

import {
  assistantMessage,
  stubThreadEnvironment,
  stubThreadViewportSize,
  ThreadRuntime,
  userMessage
} from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()
beforeEach(() => $toolDisclosureStates.set({}))
afterEach(cleanup)

const progress = '我会先核对项目实现。'
const answer = '已确认项目支持画布工作流。'

const tool = {
  type: 'tool-call',
  toolCallId: 'inspect-canvas',
  toolName: 'read_file',
  args: { path: '/repo/canvas.ts' },
  argsText: '{"path":"/repo/canvas.ts"}',
  result: { content: 'Canvas implementation' }
}

function Transcript({ messages }: { messages: ThreadMessage[] }) {
  return (
    <ThreadRuntime messages={messages}>
      <Thread />
    </ThreadRuntime>
  )
}

it.each(['live', 'history', 'mixed-final'])(
  'folds the entire process while keeping the explicit final answer outside (%s)',
  shape => {
    const live = [
      userMessage('request', '检查画布工作流'),
      {
        ...assistantMessage(),
        id: 'progress',
        content: [{ type: 'text', text: progress, displayPhase: 'commentary' }],
        metadata: { custom: { interim: true } }
      },
      {
        ...assistantMessage(),
        id: 'result',
        content: [tool, { type: 'text', text: answer, displayPhase: 'final' }],
        metadata: { custom: { durationS: 30 } }
      }
    ] as ThreadMessage[]

    const history = toChatMessages([
      { role: 'user', content: '检查画布工作流', timestamp: 1 },
      {
        role: 'assistant',
        content: progress,
        timestamp: 2,
        tool_calls: [{ id: 'inspect-canvas', function: { name: 'read_file', arguments: '{"path":"/repo/canvas.ts"}' } }]
      },
      { role: 'tool', content: '{"content":"Canvas implementation"}', tool_call_id: 'inspect-canvas', timestamp: 3 },
      { role: 'assistant', content: answer, timestamp: 4, display_metadata: { turn_metrics: { duration_s: 30 } } }
    ]).map(toRuntimeMessage)

    if (shape === 'mixed-final') {
      live[2] = {
        ...live[2],
        content: [
          ...live[2].content,
          { type: 'reasoning', text: 'Private check between final blocks' },
          { type: 'text', text: '补充结论', displayPhase: 'final' }
        ]
      } as ThreadMessage
    }

    const messages = shape === 'history' ? history : live
    const original = JSON.stringify(messages)
    const { container } = render(<Transcript messages={messages} />)
    const header = container.querySelector('[data-slot="aui_response-process-header"]') as HTMLElement
    expect(header).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="aui_response-process-header"]')).toHaveLength(1)
    const toggle = within(header).getByRole('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(container).getByText(progress).closest('[hidden]')).not.toBeNull()
    expect(within(container).getByText(answer).closest('[hidden]')).toBeNull()

    if (shape === 'mixed-final') {
      expect(within(container).getByText('补充结论').closest('[hidden]')).toBeNull()
      const processParts = container.querySelectorAll('[data-response-part-kind="process"]')
      expect([...processParts].every(part => part.closest('[hidden]'))).toBe(true)
    }

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(container).getByText(progress).closest('[hidden]')).toBeNull()
    expect(within(container).getByText(answer).closest('[hidden]')).toBeNull()
    expect(JSON.stringify(messages)).toBe(original)
  }
)

it.each([false, true])(
  'keeps the chosen disclosure (%s) after a flat live continuation and leaves partial output visible',
  async open => {
    const parts = [{ type: 'text', text: progress, displayPhase: 'commentary' }, tool]

    const completed = {
      ...assistantMessage(),
      content: [...parts, { type: 'text', text: answer, displayPhase: 'final' }],
      status: { type: 'complete', reason: 'stop' }
    } as ThreadMessage

    const { container, rerender } = render(<Transcript messages={[userMessage(), completed]} />)
    const header = container.querySelector('[data-slot="aui_response-process-header"]') as HTMLElement
    const toggle = within(header).getByRole('button')
    fireEvent.click(toggle)

    if (!open) {
      fireEvent.click(toggle)
    }

    rerender(
      <Transcript
        messages={[
          userMessage(),
          {
            ...completed,
            status: { type: 'running' }
          } as ThreadMessage
        ]}
      />
    )

    await waitFor(() => expect(container.querySelector('[data-slot="aui_response-process-header"]')).toBeNull())
    expect(within(container).getByText(progress).closest('[hidden]')).toBeNull()
    expect(within(container).getByText(answer).closest('[hidden]')).toBeNull()

    rerender(<Transcript messages={[userMessage(), completed]} />)
    await waitFor(() => {
      const settledHeader = container.querySelector('[data-slot="aui_response-process-header"]') as HTMLElement
      expect(within(settledHeader).getByRole('button').getAttribute('aria-expanded')).toBe(String(open))
    })
    await waitFor(() => expect(within(container).getByText(answer).closest('[hidden]')).toBeNull())
    expect(within(container).getByText(progress).closest('[hidden]') === null).toBe(open)

    const interrupted = {
      ...assistantMessage(),
      id: 'interrupted',
      content: [tool, { type: 'text', text: 'Partial output' }]
    } as ThreadMessage

    rerender(<Transcript messages={[userMessage(), interrupted]} />)
    await waitFor(() => expect(container.querySelector('[data-slot="aui_response-process-header"]')).toBeNull())
    expect(within(container).getByText('Partial output').closest('[hidden]')).toBeNull()
  }
)
