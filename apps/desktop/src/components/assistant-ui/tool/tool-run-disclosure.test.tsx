import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearAllPrompts } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { clearDismissedToolRows } from '@/store/tool-dismiss'
import { $toolDisclosureStates, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

stubThreadEnvironment()
stubThreadViewportSize()

const diff = '--- a/wiring.tsx\n+++ b/wiring.tsx\n@@ -1 +1 @@\n-beforeEdit\n+afterEdit'

function workMessage(): ThreadMessage {
  return {
    ...assistantMessage(),
    id: 'tool-run-disclosure',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-first',
        toolName: 'read_file',
        args: { path: '/repo/wiring.tsx' },
        argsText: '{"path":"/repo/wiring.tsx"}',
        result: { content: 'beforeEdit' }
      },
      {
        type: 'tool-call',
        toolCallId: 'edit-second',
        toolName: 'patch',
        args: { path: '/repo/wiring.tsx' },
        argsText: '{"path":"/repo/wiring.tsx"}',
        result: { success: true, path: '/repo/wiring.tsx', inline_diff: diff }
      },
      {
        type: 'tool-call',
        toolCallId: 'command-third',
        toolName: 'terminal',
        args: { command: 'pnpm run typecheck' },
        argsText: '{"command":"pnpm run typecheck"}',
        result: { exit_code: 0, stdout: 'Typecheck passed' }
      }
    ],
    status: { type: 'complete', reason: 'stop' }
  } as ThreadMessage
}

function Harness({ message }: { message: ThreadMessage }) {
  return (
    <ThreadRuntime messages={[message]}>
      <Thread />
    </ThreadRuntime>
  )
}

beforeEach(() => {
  clearAllPrompts()
  clearDismissedToolRows()
  $activeSessionId.set('sess-1')
  $toolDisclosureStates.set({})
  setHideCodeDiffs(false)
  setToolViewMode('product')
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  clearDismissedToolRows()
  $activeSessionId.set(null)
  $toolDisclosureStates.set({})
  setHideCodeDiffs(false)
  setToolViewMode('product')
})

describe('tool run disclosure', () => {
  it('keeps reads, edits and commands behind one summary while preserving review and explicit disclosure', async () => {
    const message = workMessage()
    const { container, rerender } = render(<Harness message={message} />)
    const summaries = () => container.querySelectorAll('[data-tool-summary]')
    const toggle = () => within(summaries()[0] as HTMLElement).getByRole('button')

    await waitFor(() => expect(summaries()).toHaveLength(1))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0)
    expect(summaries()[0].textContent).toMatch(/edit/i)
    expect(summaries()[0].textContent).toMatch(/explor|read/i)
    expect(summaries()[0].textContent).toMatch(/ran|run/i)

    fireEvent.click(toggle())
    await waitFor(() => expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(3))

    const editRow = container.querySelectorAll<HTMLElement>('[data-tool-row]')[1]!
    expect(editRow.textContent).toContain('wiring.tsx')

    const editToggle = editRow.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(editToggle).not.toBeNull()

    if (editToggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(editToggle)
    }

    await waitFor(() => expect(editRow.textContent).toContain('afterEdit'))
    expect(editRow.textContent).toContain('beforeEdit')

    const next = {
      ...message,
      content: [
        ...message.content,
        {
          type: 'tool-call',
          toolCallId: 'read-fourth',
          toolName: 'read_file',
          args: { path: '/repo/next.ts' },
          argsText: '{"path":"/repo/next.ts"}'
        }
      ],
      status: { type: 'running' }
    } as ThreadMessage

    rerender(<Harness message={next} />)
    await waitFor(() => expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(4))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')

    rerender(<Harness message={{ ...next, status: { type: 'complete', reason: 'stop' } }} />)
    await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'))
    fireEvent.click(toggle())
    await waitFor(() => expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0))
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a failed command visible and inspectable without expanding the successful work', async () => {
    const message = workMessage()

    const failure = {
      type: 'tool-call',
      toolCallId: 'failed-fourth',
      toolName: 'terminal',
      args: { command: 'pnpm run deploy' },
      argsText: '{"command":"pnpm run deploy"}',
      result: { error: 'Deployment permission denied', exit_code: 1 }
    }

    const { container } = render(
      <Harness message={{ ...message, content: [...message.content, failure] } as ThreadMessage} />
    )

    const error = await screen.findByLabelText('Error')
    expect(error.closest('[hidden], [inert], [data-tool-ticker]')).toBeNull()
    expect(container.querySelectorAll('[data-tool-summary]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(1)
    expect(container.querySelector('[data-tool-summary] button')?.getAttribute('aria-expanded')).toBe('false')

    const failureRow = error.closest('[data-tool-row]') as HTMLElement
    fireEvent.click(failureRow.querySelector('button[aria-expanded]')!)
    expect(await screen.findByText('Deployment permission denied')).toBeTruthy()
    expect(container.querySelector('[data-tool-summary] button')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('afterEdit')
  })
})
