import { describe, expect, it } from 'vitest'

import { summarizeToolRun, type ToolCallLike, toolPresentVerb, type ToolRunCopy } from './run-summary'

function tool(toolName: string, args: Record<string, unknown> = {}, result?: unknown): ToolCallLike {
  return { args, result, toolCallId: `${toolName}-${Math.random()}`, toolName }
}

const read = (path: string) => tool('read_file', { path }, { content: '' })
const searched = (query: string) => tool('search_files', { query }, { hits: [] })
const ran = (command: string) => tool('terminal', { command }, { exit_code: 0 })

const settled = (tools: ToolCallLike[]) => summarizeToolRun(tools, false)
const running = (tools: ToolCallLike[]) => summarizeToolRun(tools, true)

const zhCopy: ToolRunCopy = {
  delegate: { count: count => `${count} 个任务`, past: '已委派', present: '正在委派' },
  edit: { count: count => `${count} 个文件`, past: '已编辑', present: '正在编辑' },
  explore: { count: count => `${count} 个文件`, past: '已探索', present: '正在探索' },
  other: { count: count => `${count} 个工具`, past: '已使用', present: '正在使用' },
  run: { count: count => `${count} 个命令`, past: '已运行', present: '正在运行' }
}

// A run only ever holds ephemeral activity: reads, searches, commands. File
// edits and other cards are split out before a run is summarized, so there is
// no "Edited …" clause to test here — that work shows as its own diff card.
describe('summarizeToolRun', () => {
  it('names browser activity without adding browser calls to the explored-file count', () => {
    const files = [read('a.ts'), read('b.ts')]
    const browsing = [tool('browser_navigate', {}, {}), tool('browser_snapshot', {}, {})]

    expect(settled([...files, ...browsing])).toContain(settled(files))
    expect(settled(browsing)).toMatch(/used.*browser/i)
    expect(settled(browsing)).not.toMatch(/file/i)
    expect(running([tool('browser_navigate')])).toBe(toolPresentVerb('browser_navigate'))
  })

  it('uses supplied localized copy for summaries and present-tense hints', () => {
    expect(summarizeToolRun([searched('a'), read('b.ts')], false, zhCopy)).toBe('已探索 2 个文件')
    expect(toolPresentVerb('read_file', zhCopy)).toBe('正在探索')
  })

  it('names a lone target and counts the rest', () => {
    expect(settled([searched('toolRuns'), read('a.ts'), read('b.ts'), read('c.ts')])).toBe('Explored 4 files')
  })

  it('orders clauses explore then run regardless of call order', () => {
    expect(settled([ran('ls'), read('a.ts'), read('b.ts'), ran('pwd'), ran('id')])).toBe(
      'Explored 2 files, ran 3 commands'
    )
  })

  it('counts commands rather than naming them once they have run', () => {
    expect(settled([ran('git status')])).toBe('Ran 1 command')
    expect(settled([read('status.ts'), ran('a'), ran('b'), ran('c'), ran('d'), ran('e')])).toBe(
      'Explored status.ts, ran 5 commands'
    )
  })

  it('puts the running category in the present tense and leaves the rest past', () => {
    expect(running([read('a.ts'), tool('read_file', { path: 'b.ts' }), ran('x'), ran('y')])).toBe(
      'Exploring 2 files, ran 2 commands'
    )
  })

  it('counts running commands without repeating their full command lines', () => {
    const command = 'npm run typecheck'
    const summary = running([read('a.ts'), tool('terminal', { command })])

    expect(summary).toBe('Explored a.ts, running 1 command')
    expect(summary).not.toContain(command)
  })

  it('keeps every outstanding category live when parallel tools finish out of order', () => {
    const pendingRead = tool('read_file', { path: 'current.ts' })
    const pendingCommand = tool('terminal', { command: 'npm run typecheck' })
    const calls = [pendingRead, pendingCommand, ran('echo finished')]

    expect(running(calls)).toBe('Exploring current.ts, running 2 commands')
    expect(running([{ ...pendingRead, result: { content: '' } }, ...calls.slice(1)])).toBe(
      'Explored current.ts, running 2 commands'
    )
    expect(running([pendingRead, { ...pendingCommand, result: { exit_code: 0 } }, calls[2]])).toBe(
      'Exploring current.ts, ran 2 commands'
    )
  })

  // Sequential calls leave a gap where the run is still going but nothing is
  // pending. Falling back to past tense there contradicted the ticker still
  // scrolling underneath, so the most recent call carries the present tense.
  it('stays in the present tense between two sequential calls', () => {
    expect(running([read('a.ts'), ran('x'), ran('y')])).toBe('Explored a.ts, running 2 commands')
  })

  // A turn can end — or the agent can simply move on — with a call that never
  // got a result. The run is history at that point and has to read as history,
  // or it narrates work that stopped happening and never offers its toggle.
  it('reads a run the turn left unresolved as finished', () => {
    expect(settled([read('a.ts'), tool('search_files', { query: 'toolRuns' })])).toBe('Explored 2 files')
  })
})
