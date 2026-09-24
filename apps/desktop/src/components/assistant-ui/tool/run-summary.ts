import { translateNow } from '@/i18n'
import { firstStringField } from '@/lib/text'
import { extractToolErrorMessage } from '@/lib/tool-result-summary'

import { fileEditBasename, isFileEditTool, parseMaybeObject } from './fallback-model'
import { skillActivityTitle } from './skill-activity'

/**
 * The little a summary needs from a tool call, stated structurally so both
 * shapes of tool part satisfy it — the stored `ChatMessagePart` and the live
 * one assistant-ui hands to a renderer.
 */
export interface ToolCallLike {
  args?: unknown
  completedAt?: number
  isError?: boolean
  result?: unknown
  toolCallId?: string
  toolName: string
}

export function isToolCallPart<T extends { type: string }>(part: T): part is Extract<T, { type: 'tool-call' }> {
  return part.type === 'tool-call'
}

type RunCategory = 'browser' | 'delegate' | 'edit' | 'explore' | 'other' | 'run'

export interface ToolRunCopy {
  delegate: { count: (count: number) => string; past: string; present: string }
  edit: { count: (count: number) => string; past: string; present: string }
  explore: { count: (count: number) => string; past: string; present: string }
  other: { count: (count: number) => string; past: string; present: string }
  run: { count: (count: number) => string; past: string; present: string }
}

// Clause order is fixed so the same run always reads the same way, whichever
// category happens to be live.
const CATEGORY_ORDER: readonly RunCategory[] = ['edit', 'explore', 'browser', 'run', 'delegate', 'other']

const DEFAULT_COPY: ToolRunCopy = {
  delegate: { count: count => `${count} task${count === 1 ? '' : 's'}`, past: 'Delegated', present: 'Delegating' },
  edit: { count: count => `${count} file${count === 1 ? '' : 's'}`, past: 'Edited', present: 'Editing' },
  explore: { count: count => `${count} file${count === 1 ? '' : 's'}`, past: 'Explored', present: 'Exploring' },
  other: { count: count => `${count} tool${count === 1 ? '' : 's'}`, past: 'Used', present: 'Using' },
  run: { count: count => `${count} command${count === 1 ? '' : 's'}`, past: 'Ran', present: 'Running' }
}

const EXPLORE_TOOLS = new Set([
  'list_files',
  'read_file',
  'search_files',
  'session_search_recall',
  'vision_analyze',
  'web_extract',
  'web_search'
])

const EXECUTION_CATEGORIES: Record<string, RunCategory> = {
  terminal: 'run',
  execute_code: 'run',
  delegate_task: 'delegate'
}

function toolCategory(toolName: string): RunCategory {
  if (isFileEditTool(toolName)) {
    return 'edit'
  }

  if (toolName.startsWith('browser_')) {
    return 'browser'
  }

  return EXECUTION_CATEGORIES[toolName] ?? (EXPLORE_TOOLS.has(toolName) ? 'explore' : 'other')
}

function isPending(tool: ToolCallLike): boolean {
  return tool.result === undefined && tool.completedAt === undefined
}

/**
 * How a tool reads while it is happening — "Editing", "Exploring". Shared with
 * the status line that covers the gap before a tool starts, so the same run is
 * described in the same words from the moment the model drafts it.
 */
export function toolPresentVerb(toolName: string, copy: ToolRunCopy = DEFAULT_COPY): string {
  if (toolName === 'skill_view') {
    return translateNow('assistant.tool.skillActivity.loading')
  }

  if (toolName === 'execute_code') {
    return translateNow('assistant.tool.actions.runningCode')
  }

  const category = toolCategory(toolName)

  return category === 'browser'
    ? translateNow(
        'assistant.tool.titleTemplates.actionTarget',
        copy.other.present,
        translateNow('assistant.tool.prefixes.browser')
      )
    : copy[category].present
}

/** The thing a tool acted on, as the header should name it. */
function toolTarget(tool: ToolCallLike): string {
  const args = parseMaybeObject(tool.args)

  const path = firstStringField(args, ['path', 'file', 'filepath'])

  return path ? fileEditBasename(path) : firstStringField(args, ['query', 'url'])
}

/**
 * One clause per category. A category holding a single thing says what it was
 * ("Edited wiring.tsx"); anything else counts ("explored 3 files"). A settled
 * command is the exception — the summary counts commands; the current command
 * already has its own ticker line and the complete command stays in its row.
 */
function clause(category: RunCategory, tools: ToolCallLike[], live: boolean, copy: ToolRunCopy): string {
  if (category === 'browser') {
    return translateNow(
      'assistant.tool.titleTemplates.actionTarget',
      live ? copy.other.present : copy.other.past,
      translateNow('assistant.tool.prefixes.browser')
    )
  }

  if (tools.length === 1 && tools[0].toolName === 'execute_code') {
    return translateNow(live ? 'assistant.tool.actions.runningCode' : 'assistant.tool.actions.ranCode')
  }

  const categoryCopy = copy[category]
  const verb = live ? categoryCopy.present : categoryCopy.past
  const target = tools.length === 1 ? toolTarget(tools[0]) : ''

  if (target && category !== 'run') {
    return `${verb} ${target}`
  }

  return `${verb} ${categoryCopy.count(tools.length)}`
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * Collapse a run of tool calls into the single grey line that stands in for it
 * — "Explored 3 files, ran 5 commands". While the run is live, each category
 * holding outstanding calls speaks in the present tense.
 *
 * Whether the run is `live` is the caller's to say, not something readable off
 * the calls: a call can be left without a result by a turn that ended or an
 * agent that moved on, and a run like that has to read as finished rather than
 * narrate work that stopped happening.
 *
 * A run only ever holds ephemeral activity — file edits and other cards are
 * split out before this sees them (`splitRunItems`), so there is no aggregate
 * diff to report here; each edit carries its own +N/−M on its card.
 */
export function summarizeToolRun(
  tools: readonly ToolCallLike[],
  live: boolean,
  copy: ToolRunCopy = DEFAULT_COPY
): string {
  // Parallel calls may leave several categories outstanding. Finishing a
  // newer call must not turn an earlier pending category into completed work.
  const pending = live ? tools.filter(isPending) : []
  const narrating = pending.length ? pending : live ? tools.slice(-1) : []
  const liveCategories = new Set(narrating.map(tool => toolCategory(tool.toolName)))

  const byCategory = new Map<RunCategory, ToolCallLike[]>()
  const skillClauses: string[] = []

  for (const tool of tools) {
    const skill = skillActivityTitle(tool, live)

    if (skill) {
      skillClauses.push(skill)

      continue
    }

    const category = toolCategory(tool.toolName)
    const group = byCategory.get(category)

    if (group) {
      group.push(tool)
    } else {
      byCategory.set(category, [tool])
    }
  }

  const clauses = CATEGORY_ORDER.flatMap(category => {
    const group = byCategory.get(category)

    return group ? [clause(category, group, liveCategories.has(category), copy)] : []
  })

  const failed = tools.filter(tool => {
    const result = parseMaybeObject(tool.result)

    // Explicit success beats stale envelope errors, as in individual rows.
    return (
      result.success !== true &&
      result.ok !== true &&
      Boolean(tool.isError || result.success === false || result.ok === false || extractToolErrorMessage(tool.result))
    )
  }).length

  if (failed) {
    clauses.push(translateNow('assistant.tool.failedCalls', failed))
  }

  return [...skillClauses, ...clauses].map((text, index) => (index === 0 ? text : lowerFirst(text))).join(', ')
}
