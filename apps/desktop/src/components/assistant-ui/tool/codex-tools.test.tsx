import type { ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { deriveChangedFiles } from '@/components/assistant-ui/thread/changed-files'
import { ChangedFilesCard } from '@/components/assistant-ui/thread/changed-files-card'
import { setRuntimeI18nLocale } from '@/i18n'
import { en } from '@/i18n/en'
import { isFileEditTool } from '@/lib/tool-render-class'
import { $toolDisclosureStates, setHideCodeDiffs, setToolViewMode } from '@/store/tool-view'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

import { buildToolView, type ToolPart } from './fallback-model'
import { summarizeToolRun } from './run-summary'

stubThreadEnvironment()
stubThreadViewportSize()

const command = {
  type: 'tool-call',
  toolCallId: 'codex_exec_test',
  toolName: 'exec_command',
  args: { command: 'npm test', cwd: '/repo' },
  result: { output: '3 tests passed', exit_code: 0, duration_s: 1.25, status: 'completed' }
} satisfies ToolPart

beforeEach(() => {
  setRuntimeI18nLocale('en')
  setToolViewMode('product')
  setHideCodeDiffs(false)
  $toolDisclosureStates.set({})
})
afterEach(cleanup)

it('presents a native command as a shell execution, including older stored receipts', () => {
  for (const result of [command.result, JSON.stringify(command.result), '3 tests passed']) {
    const view = buildToolView({ ...command, result }, '')
    expect(view.title).toContain('npm test')
    expect(view.tone).toBe('terminal')
    expect(view.terminalCommand).toBe('npm test')
    expect(view.detail).toContain('3 tests passed')
  }

  const view = buildToolView(command, '')
  expect(view.terminalExitCode).toBe(0)
  expect(view.durationLabel).toBeTruthy()
})

it('opens the actual command and output from a native execution-log row', async () => {
  const { container } = render(
    <ThreadRuntime messages={[{ ...assistantMessage(), content: [{ ...command, argsText: '{}' }] } as ThreadMessage]}>
      <Thread />
    </ThreadRuntime>
  )

  fireEvent.click(container.querySelector('[data-tool-summary] button[aria-expanded]')!)
  await waitFor(() => expect(container.querySelector('[data-tool-row]')?.textContent).toContain('npm test'))
  fireEvent.click(container.querySelector('[data-tool-row] button[aria-expanded]')!)
  await waitFor(() => expect(container.querySelector('[data-terminal-command]')?.textContent).toContain('npm test'))
  expect(container.querySelector('[data-terminal-output]')?.textContent).toContain('3 tests passed')
})

it('keeps native patches reviewable with file names rather than a generic tool label', () => {
  expect(isFileEditTool('apply_patch')).toBe(true)

  const view = buildToolView(
    {
      ...command,
      toolName: 'apply_patch',
      args: {
        changes: [
          { path: '/repo/a.ts', kind: 'update' },
          { path: '/repo/b.ts', kind: 'add' }
        ]
      },
      result: { success: true }
    },
    '--- a.ts\n+++ b.ts\n-old\n+new'
  )

  expect(view.title).toContain('a.ts')
  expect(view.title).toContain('b.ts')
  expect(view.tone).toBe('file')
})

it('counts every native patch path in the execution summary', () => {
  expect(
    summarizeToolRun(
      [
        {
          ...command,
          toolName: 'apply_patch',
          args: {
            changes: [{ path: '/repo/a.ts' }, { path: '/repo/b.ts' }]
          }
        }
      ],
      false
    )
  ).toContain('2 files')
})

it('retains JSON printed by older native command records', () => {
  for (const output of ['{"answer":42}', '{"status":"ready","answer":42}', '{"output":"model data"}']) {
    expect(buildToolView({ ...command, result: output }, '').detail).toBe(output)
    expect(buildToolView({ ...command, result: JSON.parse(output) }, '').detail).toBe(output)
  }
})

it('renders all fields of JSON stdout instead of mistaking them for separate streams', async () => {
  const output = '{"stdout":"hello","stderr":"fixture log","answer":42}'

  const { container } = render(
    <ThreadRuntime
      messages={[{ ...assistantMessage(), content: [{ ...command, result: output, argsText: '{}' }] } as ThreadMessage]}
    >
      <Thread />
    </ThreadRuntime>
  )

  fireEvent.click(container.querySelector('[data-tool-summary] button[aria-expanded]')!)
  await waitFor(() => expect(container.querySelector('[data-tool-row]')).not.toBeNull())
  fireEvent.click(container.querySelector('[data-tool-row] button[aria-expanded]')!)
  await waitFor(() => expect(container.querySelector('[data-terminal-output]')?.textContent).toBe(output))
})

it('assigns native patch diffs and statistics to each actual file', () => {
  const diffA = '--- /repo/index.html\n+++ /repo/index.html\n@@ -1 +1 @@\n-old html\n+new html'
  const diffB = '--- /dev/null\n+++ /repo/b.ts\n@@ -0,0 +1,2 @@\n+line 1\n+line 2'

  const parts = [
    {
      ...command,
      toolName: 'apply_patch',
      args: {},
      result: {
        status: 'completed',
        success: true,
        changes: [
          { path: '/repo/index.html', kind: { type: 'update' }, diff: diffA },
          { path: '/repo/b.ts', kind: { type: 'add' }, diff: diffB }
        ]
      }
    }
  ]

  const files = deriveChangedFiles(parts)
  expect(files).toEqual([
    { path: '/repo/index.html', name: 'index.html', added: 1, removed: 1, diffs: [diffA] },
    { path: '/repo/b.ts', name: 'b.ts', added: 2, removed: 0, diffs: [diffB] }
  ])
  render(<ChangedFilesCard parts={parts} />)
  fireEvent.click(screen.getByRole('button', { name: en.assistant.thread.reviewChanges }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '/repo/b.ts' }))
  expect(within(screen.getByRole('dialog')).getByText('line 1')).toBeTruthy()
  expect(within(screen.getByRole('dialog')).queryByText('new html')).toBeNull()
})
