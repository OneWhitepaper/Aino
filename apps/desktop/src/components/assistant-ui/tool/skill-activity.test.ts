import { describe, expect, it } from 'vitest'

import { summarizeToolRun } from './run-summary'
import { skillActivityTitle } from './skill-activity'

const skill = { type: 'tool-call' as const, toolName: 'skill_view', args: { name: 'research-notes' } }

describe('skill activity identity', () => {
  it('keeps the summary compact while individual skill records retain identity and failure', () => {
    const calls = [
      { ...skill, result: 'instructions' },
      { ...skill, args: { name: 'second-skill' }, result: { error: 'not found' } },
      { toolName: 'terminal', args: { command: 'echo ok' }, result: { stdout: 'ok' } }
    ]

    const summary = summarizeToolRun(calls, false)

    expect(summary).toContain('used 2 tools')
    expect(summary).toContain('Ran 1 command')
    expect(summary).toContain('1 tool call failed')
    expect(skillActivityTitle(calls[0], false)).toBe('Loaded skill: research-notes')
    expect(skillActivityTitle(calls[1], false)).toBe('Failed to load skill: second-skill')
  })
})
