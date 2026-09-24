import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

import { $displayTimestamps } from '@/store/display-timestamps'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { clearDismissedToolRows } from '@/store/tool-dismiss'
import { $toolDisclosureStates } from '@/store/tool-view'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'
import { formatTimelineRange } from '../thread/timestamp'

import { MAX_TOOL_RENDER_CHARS } from './fallback-model'

// Timeline timestamps render only when `display.timestamps` is enabled.
$displayTimestamps.set(true)

// Tool runs retain their own disclosure behavior. Approvals belong to a
// persistent transcript host outside those runs, so collapsing or mounting a
// tool row cannot hide or relocate the decision.

const createdAt = new Date('2026-06-03T00:00:00.000Z')

const resizeObservers = new Set<TestResizeObserver>()

// This suite drives resizes by hand, so it needs observers it can reach.
class TestResizeObserver {
  private target: Element | null = null

  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.add(this)
  }

  observe(target: Element) {
    this.target = target
  }

  unobserve() {}

  disconnect() {
    resizeObservers.delete(this)
  }
}

stubThreadEnvironment()
stubThreadViewportSize()
vi.stubGlobal('ResizeObserver', TestResizeObserver)

// A running assistant message with two tools: a completed read_file plus a
// pending terminal (no result), rendered as a flat two-row list.
function groupedPendingMessage(): ThreadMessage {
  return {
    id: 'assistant-group-1',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        result: { content: '127.0.0.1 localhost' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-1',
        toolName: 'terminal',
        args: { command: 'rm -rf /tmp/x' },
        argsText: JSON.stringify({ command: 'rm -rf /tmp/x' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

function pendingOnlyMessage(): ThreadMessage {
  return {
    id: 'assistant-pending-only',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-only',
        toolName: 'terminal',
        args: { command: 'sleep 10' },
        argsText: JSON.stringify({ command: 'sleep 10' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

function completedOnlyMessage(): ThreadMessage {
  return {
    id: 'assistant-completed-only',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-only',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        timestamp: createdAt.getTime() / 1000 + 10.125,
        completedAt: createdAt.getTime() / 1000 + 12.875,
        result: { content: '127.0.0.1 localhost' }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

function failedOnlyMessage(): ThreadMessage {
  return {
    id: 'assistant-failed-only',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-failed',
        toolName: 'terminal',
        args: { command: 'exit 1' },
        argsText: JSON.stringify({ command: 'exit 1' }),
        isError: true,
        result: { stderr: 'boom' }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Two settled activity calls in a row, so the run earns a summary line and
// collapses behind it.
function settledRunMessage(): ThreadMessage {
  return {
    id: 'assistant-settled-run',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-2',
        toolName: 'read_file',
        args: { path: '/repo/src/wiring.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/wiring.tsx' }),
        timestamp: createdAt.getTime() / 1000 + 20,
        completedAt: createdAt.getTime() / 1000 + 21,
        result: { content: 'export const Wiring = () => null' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-3',
        toolName: 'terminal',
        args: { command: 'ls -la' },
        argsText: JSON.stringify({ command: 'ls -la' }),
        timestamp: createdAt.getTime() / 1000 + 22,
        completedAt: createdAt.getTime() / 1000 + 23.5,
        result: { exit_code: 0, stdout: 'wiring.tsx' }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Activity, an edit, then more activity — all adjacent, so assistant-ui hands
// the whole stretch over as one group. The edit is the deliverable and has to
// survive that as its own card.
function editBetweenRunsMessage(): ThreadMessage {
  return {
    id: 'assistant-edit-between-runs',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-5',
        toolName: 'read_file',
        args: { path: '/repo/src/a.ts' },
        argsText: JSON.stringify({ path: '/repo/src/a.ts' }),
        result: { content: 'a' }
      },
      {
        type: 'tool-call',
        toolCallId: 'search-3',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' }),
        result: { hits: [] }
      },
      {
        type: 'tool-call',
        toolCallId: 'patch-2',
        toolName: 'patch',
        args: { path: '/repo/src/wiring.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/wiring.tsx' }),
        result: { path: '/repo/src/wiring.tsx', inline_diff: '--- a\n+++ b\n+added line\n-removed line' }
      },
      {
        type: 'tool-call',
        toolCallId: 'read-6',
        toolName: 'read_file',
        args: { path: '/repo/src/b.ts' },
        argsText: JSON.stringify({ path: '/repo/src/b.ts' }),
        result: { content: 'b' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-4',
        toolName: 'terminal',
        args: { command: 'ls' },
        argsText: JSON.stringify({ command: 'ls' }),
        result: { exit_code: 0 }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// A finished turn that left a call without a result — interrupted, or the
// result landed elsewhere. The run is history and has to behave like it.
function abandonedRunMessage(): ThreadMessage {
  return {
    id: 'assistant-abandoned-run',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-3',
        toolName: 'read_file',
        args: { path: '/repo/src/status.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/status.tsx' }),
        result: { content: 'export const Status = () => null' }
      },
      {
        type: 'tool-call',
        toolCallId: 'search-1',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' })
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// The gap between one sequential call finishing and the next arriving: the
// turn is still running, the run is still the tail, but for this instant every
// call has a result.
function betweenSequentialCallsMessage(): ThreadMessage {
  return {
    id: 'assistant-between-calls',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-a',
        toolName: 'terminal',
        args: { command: 'sleep 2; echo alpha' },
        argsText: JSON.stringify({ command: 'sleep 2; echo alpha' }),
        result: { exit_code: 0, stdout: 'alpha' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-b',
        toolName: 'terminal',
        args: { command: 'sleep 2; echo bravo' },
        argsText: JSON.stringify({ command: 'sleep 2; echo bravo' }),
        result: { exit_code: 0, stdout: 'bravo' }
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Still streaming, but the agent has moved past its first run and left both of
// its calls unresolved. Only the run at the tail is still live.
function movedOnMessage(): ThreadMessage {
  return {
    id: 'assistant-moved-on',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-4',
        toolName: 'read_file',
        args: { path: '/repo/src/status.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/status.tsx' })
      },
      {
        type: 'tool-call',
        toolCallId: 'search-2',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' })
      },
      { type: 'text', text: 'Let me read the rest of the file.' },
      {
        type: 'tool-call',
        toolCallId: 'term-2',
        toolName: 'terminal',
        args: { command: 'ls' },
        argsText: JSON.stringify({ command: 'ls' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

const GroupHarness = ({ message }: { message: ThreadMessage }) => (
  <ThreadRuntime messages={[message]}>
    <Thread />
  </ThreadRuntime>
)

beforeEach(() => {
  clearAllPrompts()
  $activeSessionId.set('sess-1')
  $toolDisclosureStates.set({})
  clearDismissedToolRows()
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  $activeSessionId.set(null)
  clearDismissedToolRows()
})

describe('settled tool run', () => {
  it('collapses to a summary line naming the work', async () => {
    const { container } = render(<GroupHarness message={settledRunMessage()} />)

    expect(await screen.findByText('Explored wiring.tsx, ran 1 command')).toBeTruthy()
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0)
  })

  it('expands to the underlying rows when the summary is clicked', async () => {
    const { container } = render(<GroupHarness message={settledRunMessage()} />)

    fireEvent.click(await screen.findByText('Explored wiring.tsx, ran 1 command'))

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tool-row]').length).toBeGreaterThan(0)
    })
  })

  it('leaves a lone tool call as its own row, with no summary above it', async () => {
    const { container } = render(<GroupHarness message={completedOnlyMessage()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tool-row]').length).toBe(1)
    })
    expect(container.querySelector('[data-tool-summary]')).toBeNull()
  })
})

// A diff is what the user reviews, so it is never what gets summarized away.
// It stays on screen at the point in the turn where it happened, with the
// activity either side of it collapsing around it.
describe('a file edit among ordinary activity', () => {
  it('stays visible between the two runs it interrupted', async () => {
    const { container } = render(<GroupHarness message={editBetweenRunsMessage()} />)

    await screen.findByText('Explored 2 files')

    const shape = [...container.querySelectorAll('[data-tool-summary],[data-tool-row]')].map(node =>
      node.hasAttribute('data-tool-summary') ? 'summary' : 'row'
    )

    expect(shape).toEqual(['summary', 'row', 'summary'])
  })

  it('keeps the diff itself on screen rather than behind the summary', async () => {
    const { container } = render(<GroupHarness message={editBetweenRunsMessage()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-tool-row][data-file-edit]')).not.toBeNull()
    })
  })
})

// The transcript rests its scaffolding at a fade, keyed off one attribute. A
// surface that renders without it is brighter than everything around it, which
// is how two adjacent, identical rows came to sit at two opacities.
describe('transcript fade', () => {
  it('marks every row and summary as scaffolding', async () => {
    const { container } = render(<GroupHarness message={editBetweenRunsMessage()} />)

    await screen.findByText('Explored 2 files')

    const unmarked = [...container.querySelectorAll('[data-tool-summary],[data-tool-row]')].filter(
      node => !node.hasAttribute('data-conversation-scaffold')
    )

    expect(unmarked).toHaveLength(0)
  })
})

describe('live tool run', () => {
  it('shows the latest pending call while keeping older ticker rows mounted and inaccessible', async () => {
    const message = groupedPendingMessage()
    const { container, rerender } = render(<GroupHarness message={message} />)
    const rows = () => [...container.querySelectorAll('.tool-ticker__row')]

    await waitFor(() => expect(rows()).toHaveLength(message.content.length))
    expect(rows().every(row => row.querySelectorAll('[data-tool-row]').length === 1)).toBe(true)
    expect(rows()[0]?.textContent).toContain('hosts')
    expect(rows().at(-1)?.textContent).toContain('rm -rf /tmp/x')
    expect(rows()[0]?.hasAttribute('inert')).toBe(true)
    expect(rows()[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(within(container).queryByRole('button', { name: 'Read hosts' })).toBeNull()
    const initialRows = rows()

    const next = {
      ...message,
      content: [
        ...message.content,
        {
          type: 'tool-call',
          toolCallId: 'term-next',
          toolName: 'terminal',
          args: { command: 'echo newest-command' },
          argsText: '{}'
        }
      ]
    } as ThreadMessage

    rerender(<GroupHarness message={next} />)
    await waitFor(() => expect(rows()).toHaveLength(next.content.length))
    expect(rows().every(row => row.querySelectorAll('[data-tool-row]').length === 1)).toBe(true)
    expect(rows().at(-1)?.textContent).toContain('newest-command')
    const reel = container.querySelector('.tool-ticker__reel') as HTMLElement
    expect(Number(reel.style.getPropertyValue('--tool-ticker-index'))).toBe(rows().length - 1)
    initialRows.forEach((row, index) => expect(rows()[index]).toBe(row))

    // The newer parallel call finishes first. The older pending call must
    // become the visible row rather than leaving a completed row in the window.
    rerender(
      <GroupHarness
        message={
          {
            ...next,
            content: [...message.content, { ...next.content[2], result: { output: 'newest-command', exit_code: 0 } }]
          } as ThreadMessage
        }
      />
    )
    await waitFor(() => expect(Number(reel.style.getPropertyValue('--tool-ticker-index'))).toBe(1))
    expect(rows()[1]?.hasAttribute('inert')).toBe(false)
    expect(rows()[1]?.getAttribute('aria-hidden')).not.toBe('true')
    expect(rows()[2]?.hasAttribute('inert')).toBe(true)
    expect(rows()[2]?.getAttribute('aria-hidden')).toBe('true')
    expect(within(container).queryByRole('button', { name: /Ran echo newest-command/ })).toBeNull()
    initialRows.forEach((row, index) => expect(rows()[index]).toBe(row))
  })

  it('honors explicit disclosure across live updates and completion', async () => {
    const message = groupedPendingMessage()
    const { container, rerender } = render(<GroupHarness message={message} />)
    const toggle = () => container.querySelector('[data-tool-summary] button[aria-expanded]') as HTMLButtonElement

    await waitFor(() => expect(toggle()).not.toBeNull())
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-tool-ticker]')).toBeNull()
    const pendingRow = container.querySelectorAll('[data-tool-row]')[1] as HTMLElement
    fireEvent.click(within(pendingRow).getByRole('button'))
    expect(within(container).getByRole('region', { name: 'Shell' })).not.toBeNull()
    fireEvent.click(toggle())
    expect(within(container).queryByRole('region', { name: 'Shell' })).toBeNull()
    expect(container.querySelector('[data-tool-ticker] [data-tool-details]')).toBeNull()

    const row = container.querySelector(
      '.tool-ticker__row:not([aria-hidden="true"]) [data-tool-row] button[aria-expanded="false"]'
    )

    expect(row).not.toBeNull()
    fireEvent.click(row as Element)
    await waitFor(() => expect(container.querySelector('[data-tool-ticker]')).toBeNull())
    expect(within(container).getByRole('region', { name: 'Shell' })).not.toBeNull()

    const next = {
      ...message,
      content: [
        ...message.content,
        {
          type: 'tool-call',
          toolCallId: 'read-next',
          toolName: 'read_file',
          args: { path: '/tmp/next' },
          argsText: '{}'
        }
      ]
    } as ThreadMessage

    rerender(<GroupHarness message={next} />)
    await waitFor(() => expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(3))
    rerender(<GroupHarness message={{ ...next, status: { type: 'complete', reason: 'stop' } }} />)
    await waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'))
    fireEvent.click(toggle())
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0)
  })

  it.each(['text', 'reasoning'])(
    'keeps pending work live past a separate failed tool until a real %s continuation',
    async type => {
      const message = groupedPendingMessage()

      const parts = [
        ...message.content,
        {
          type: 'tool-call',
          toolCallId: 'parallel-failure',
          toolName: 'terminal',
          args: { command: 'parallel-check' },
          argsText: '{"command":"parallel-check"}',
          isError: true,
          result: { error: 'Parallel check failed', exit_code: 127 }
        },
        { type: 'text', text: '  ' }
      ]

      const { container, rerender } = render(<GroupHarness message={{ ...message, content: parts } as ThreadMessage} />)

      const ticker = container.querySelector('[data-tool-ticker]')
      expect(ticker).not.toBeNull()
      expect(ticker?.textContent).toContain('rm -rf /tmp/x')
      expect(container.querySelector('[data-tool-summary] .shimmer')).not.toBeNull()
      const failure = within(container).getByLabelText('Error')
      expect(failure.closest('[inert], [hidden], [data-tool-ticker]')).toBeNull()

      rerender(
        <GroupHarness
          message={{ ...message, content: [...parts, { type, text: 'I will explain the failure.' }] } as ThreadMessage}
        />
      )
      await waitFor(() => expect(container.querySelector('[data-tool-ticker]')).toBeNull())
      expect(container.querySelector('[data-tool-summary] .shimmer')).toBeNull()
      expect(within(container).getByLabelText('Error').closest('[inert], [hidden]')).toBeNull()
    }
  )

  it('updates named skill summaries when identifying arguments arrive late', async () => {
    const message = groupedPendingMessage()
    const first = { ...message.content[0], toolName: 'skill_view', args: {}, result: { success: true } }

    const { container, rerender } = render(
      <GroupHarness message={{ ...message, content: [first, message.content[1]] } as ThreadMessage} />
    )

    const summary = () => container.querySelector('[data-tool-summary]')?.textContent
    await waitFor(() => expect(summary()).toContain('Loaded skill'))
    const named = { ...first, args: { name: 'research-notes' } }
    rerender(<GroupHarness message={{ ...message, content: [named, message.content[1]] } as ThreadMessage} />)
    await waitFor(() => expect(summary()).toContain('research-notes'))
  })

  it('rests between sequential calls and resumes live activity when the next call arrives', async () => {
    const message = betweenSequentialCallsMessage()
    const { container, rerender } = render(<GroupHarness message={message} />)

    expect(await screen.findByText('Ran 2 commands')).toBeTruthy()
    expect(container.querySelector('[data-tool-ticker]')).toBeNull()
    expect(container.querySelector('[data-tool-summary] .shimmer')).toBeNull()
    expect(container.querySelector('[data-tool-summary] button[aria-expanded]')).not.toBeNull()

    const nextCall = {
      type: 'tool-call',
      toolCallId: 'term-next',
      toolName: 'terminal',
      args: { command: 'echo charlie' },
      argsText: '{}'
    } as const

    rerender(<GroupHarness message={{ ...message, content: [...message.content, nextCall] } as ThreadMessage} />)
    await waitFor(() => expect(container.querySelector('[data-tool-ticker]')).not.toBeNull())
    expect(container.querySelector('[data-tool-summary] .shimmer')).not.toBeNull()

    rerender(
      <GroupHarness
        message={
          {
            ...message,
            content: [...message.content, { ...nextCall, result: { exit_code: 0, stdout: 'charlie' } }]
          } as ThreadMessage
        }
      />
    )
    await waitFor(() => expect(container.querySelector('[data-tool-ticker]')).toBeNull())
  })

  // The ticker is a one-line window, so a row opened inside it had its output
  // sliced to that line and then ticked away by the next call. Opening a row
  // is a request to read it: the run gives up the window until it settles.
  it('drops the one-line window when a row inside it is opened', async () => {
    const { container } = render(<GroupHarness message={groupedPendingMessage()} />)

    await waitFor(() => expect(container.querySelector('[data-tool-ticker]')).not.toBeNull())

    const row = container.querySelector('[data-tool-ticker] [data-tool-row] button[aria-expanded="false"]')

    expect(row).not.toBeNull()

    fireEvent.click(row as Element)

    await waitFor(() => {
      expect(container.querySelector('[data-tool-ticker]')).toBeNull()
    })

    // ...and the row it opened is still on screen to be read.
    expect(container.querySelector('[data-tool-row][data-tool-open]')).not.toBeNull()
  })
})

// A run whose calls never resolved used to read as live forever, which stranded
// it in the present tense and — because a live run withholds its toggle — left
// it permanently expanded with no way to collapse it.
describe('tool run left unresolved', () => {
  it('settles with the turn rather than narrating work that stopped', async () => {
    const { container } = render(<GroupHarness message={abandonedRunMessage()} />)

    expect(await screen.findByText('Explored 2 files')).toBeTruthy()
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0)
    expect(container.querySelector('[data-tool-summary] button[aria-expanded]')).not.toBeNull()
  })

  it('settles once the agent moves on, even mid-turn', async () => {
    const { container } = render(<GroupHarness message={movedOnMessage()} />)

    expect(await screen.findByText('Explored 2 files')).toBeTruthy()
    expect(container.querySelector('[data-tool-summary] button[aria-expanded]')).not.toBeNull()
  })
})

describe('flat tool list approval surfacing', () => {
  it('keeps the approval host empty when there is no live approval', async () => {
    const { container } = render(<GroupHarness message={groupedPendingMessage()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="tool-block"]').length).toBeGreaterThan(0)
    })
    expect(container.querySelector('[data-approval-stack]')).not.toBeNull()
    expect(container.querySelector('[data-approval-stack] [data-approval-run]')).toBeNull()
  })

  it('keeps the approval visible in the same host when tool rows arrive', async () => {
    setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'dangerous command', sessionId: 'sess-1' })
    const message = groupedPendingMessage()
    assert(message.role === 'assistant')

    const { container, rerender } = render(
      <GroupHarness message={{ ...message, content: [{ type: 'text', text: 'Waiting for approval.' }] }} />
    )

    const run = await screen.findByRole('button', { name: /Run/ })
    const host = run.closest('[data-approval-stack]')
    expect(host).not.toBeNull()
    expect(host?.parentElement?.getAttribute('data-slot')).toBe('aui_thread-content')
    expect(host?.closest('[hidden], [inert], [data-tool-row], [data-tool-group]')).toBeNull()

    rerender(<GroupHarness message={message} />)

    await waitFor(() => {
      expect(container.querySelector('[data-approval-stack]')).toBe(host)
      expect(screen.getByRole('button', { name: /Run/ })).toBe(run)
      expect(run.closest('[hidden], [inert]')).toBeNull()
      expect(screen.getByRole('button', { name: /Reject/ })).toBeTruthy()
    })
  })

  it('lets completed tool rows be dismissed', async () => {
    const { container } = render(<GroupHarness message={completedOnlyMessage()} />)

    const dismiss = await screen.findByLabelText('Dismiss')

    expect(container.querySelectorAll('[data-slot="tool-block"]').length).toBeGreaterThan(0)

    fireEvent.click(dismiss)

    await waitFor(() => {
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
    })
  })

  it('keeps a dismissed row hidden after a remount (virtualization)', async () => {
    // The thread virtualizes, so a row's component unmounts/remounts as it
    // scrolls. Dismissal must persist across that — component-local state would
    // forget it and the row would pop back. Simulate the remount by unmounting
    // and rendering the same message fresh.
    const first = render(<GroupHarness message={completedOnlyMessage()} />)

    fireEvent.click(await screen.findByLabelText('Dismiss'))

    await waitFor(() => {
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
    })

    first.unmount()

    render(<GroupHarness message={completedOnlyMessage()} />)

    // The row is the only thing this message renders, so staying dismissed
    // means nothing comes back — including its dismiss control.
    await waitFor(() => {
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
    })
  })

  it('lets failed tool rows be dismissed', async () => {
    render(<GroupHarness message={failedOnlyMessage()} />)

    const dismiss = await screen.findByLabelText('Dismiss')

    fireEvent.click(dismiss)

    await waitFor(() => {
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
    })
  })

  it('does not show dismiss for pending tool rows', async () => {
    const { container } = render(<GroupHarness message={pendingOnlyMessage()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="tool-block"]').length).toBeGreaterThan(0)
    })

    expect(screen.queryByLabelText('Dismiss')).toBeNull()
  })
})

describe('tool error explanations', () => {
  it('keeps lookup misses neutral and exposes actual failures when expanded', async () => {
    for (const [error, destructive] of [
      ['File not found: /repo/session-view.ts', false],
      ['Permission denied reading /repo/session-view.ts', true]
    ] as const) {
      const message = completedOnlyMessage()

      assert(message.role === 'assistant')

      const part = message.content[0]!

      assert(part.type === 'tool-call')

      const { container, unmount } = render(
        <GroupHarness
          message={{
            ...message,
            content: [{ ...part, result: { error }, args: { path: '/repo/session-view.ts' } }]
          }}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: /Failed to read session-view\.ts/ }))

      await waitFor(() => expect(container.textContent).toContain(error))
      expect(Boolean(container.querySelector('[data-tool-row] .text-destructive'))).toBe(destructive)
      unmount()
      $toolDisclosureStates.set({})
    }
  })
})

describe('tool lifecycle timestamps', () => {
  it('keeps a settled row quiet and reveals its precise lifecycle on expansion', async () => {
    const { container } = render(<GroupHarness message={completedOnlyMessage()} />)

    const toggle = await screen.findByRole('button', { name: 'Read hosts' })

    expect(container.querySelector('[data-tool-row] [data-slot="timeline-timestamp"]')).toBeNull()
    fireEvent.click(toggle)

    const timestamps = Array.from(
      container.querySelectorAll('[data-tool-details] [data-slot="timeline-timestamp"]')
    ).map(node => node.textContent?.trim())

    const startedAt = createdAt.getTime() / 1000 + 10.125

    expect(timestamps).toContain(formatTimelineRange(startedAt, createdAt.getTime() / 1000 + 12.875))
  })

  it('keeps the full lifecycle range available inside an expanded settled run', async () => {
    const { container } = render(<GroupHarness message={settledRunMessage()} />)

    await waitFor(() => expect(container.querySelector('[data-tool-summary]')).toBeTruthy())

    expect(container.querySelector('[data-tool-summary] [data-slot="timeline-timestamp"]')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Explored wiring.tsx, ran 1 command' }))

    const timestamps = Array.from(
      container.querySelectorAll('[data-tool-run-details] [data-slot="timeline-timestamp"]')
    ).map(node => node.textContent?.trim())

    expect(timestamps).toContain(
      formatTimelineRange(createdAt.getTime() / 1000 + 20, createdAt.getTime() / 1000 + 23.5)
    )
  })
})

describe('expanded terminal transcript', () => {
  function terminalMessage(part: Record<string, unknown>, running = false): ThreadMessage {
    const message = pendingOnlyMessage()
    assert(message.role === 'assistant')
    const source = message.content[0]!
    assert(source.type === 'tool-call')
    const terminal = { ...source, timestamp: createdAt.getTime() / 1000, ...part }

    return {
      ...message,
      content: [terminal],
      status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' }
    }
  }

  it('shows the original command and output once and copies the full transcript beyond the render limit', async () => {
    const originalNavigator = navigator
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...originalNavigator, clipboard: { writeText } })

    try {
      const command = 'printf "one\\ntwo\\n"; cat /tmp/complete-output.txt'
      const output = `BEGIN-SHELL-OUTPUT\n${'recorded output\n'.repeat(Math.ceil(MAX_TOOL_RENDER_CHARS / 16) + 100)}END-SHELL-OUTPUT`
      const stderr = 'Additional diagnostic information.'

      const { container } = render(
        <GroupHarness
          message={terminalMessage({
            args: { command, context: 'Running printf + 1 command' },
            argsText: JSON.stringify({ command }),
            result: { stdout: output, stderr, exit_code: 0 }
          })}
        />
      )

      expect(screen.queryByRole('region', { name: 'Shell' })).toBeNull()
      const toggle = container.querySelector('[data-tool-row] button[aria-expanded]') as HTMLButtonElement
      fireEvent.click(toggle)

      const panel = await screen.findByRole('region', { name: 'Shell' })
      expect(panel.textContent?.split(command)).toHaveLength(2)
      expect(panel.textContent?.split('BEGIN-SHELL-OUTPUT')).toHaveLength(2)
      expect(panel.textContent?.split(stderr)).toHaveLength(2)
      expect(container.textContent?.split('BEGIN-SHELL-OUTPUT')).toHaveLength(2)
      fireEvent.click(within(panel).getByRole('button', { name: 'Copy' }))

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const copied = writeText.mock.calls[0]![0] as string
      expect(copied).toContain(command)
      expect(copied).toContain(output)
      expect(copied.split(stderr)).toHaveLength(2)
      expect(copied.split(command)).toHaveLength(2)
      expect(copied.split('BEGIN-SHELL-OUTPUT')).toHaveLength(2)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    } finally {
      vi.stubGlobal('navigator', originalNavigator)
    }
  })

  it.each([
    { name: 'completed', part: { result: { output: 'done', exit_code: 0 } }, label: 'Done', exit: 0 },
    { name: 'nonzero exit with output', part: { result: { output: 'partial output', exit_code: 7 } }, label: 'exit 7' },
    {
      name: 'background launch',
      part: { result: { output: 'Background process started', session_id: 'proc-one', pid: 42, exit_code: 0 } },
      label: 'Running in background'
    },
    {
      name: 'yielded background launch',
      part: {
        result: { output: 'Still working', status: 'yielded_to_background', session_id: 'proc-two', exit_code: null }
      },
      label: 'Running in background'
    },
    { name: 'missing result', part: { completedAt: 5 }, label: 'Result unavailable' },
    { name: 'interrupted', part: { completedAt: 5, interrupted: true }, label: 'Interrupted' },
    {
      name: 'real result arriving after interruption',
      part: { interrupted: true, result: { output: 'done', exit_code: 0 } },
      label: 'Done',
      exit: 0
    },
    {
      name: 'explicit failure',
      part: { isError: true, result: { output: 'partial', error: 'Permission denied', exit_code: 0 } },
      label: 'Error'
    },
    { name: 'pending', part: {}, running: true, label: 'Running' }
  ])('reports $name without inventing successful completion', async ({ part, running, label, exit }) => {
    const { container } = render(<GroupHarness message={terminalMessage(part, running)} />)
    const toggle = container.querySelector('[data-tool-row] button[aria-expanded]') as HTMLButtonElement
    fireEvent.click(toggle)

    const panel = await screen.findByRole('region', { name: 'Shell' })
    const status = panel.querySelector('[data-terminal-status]')
    expect(status?.textContent).toContain(label)

    if (exit === 0) {
      expect(status?.textContent).toContain('exit 0')
    } else {
      expect(status?.textContent).not.toContain('Done')
    }
  })
})
