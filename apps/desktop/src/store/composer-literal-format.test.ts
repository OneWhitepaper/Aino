import { describe, expect, it } from 'vitest'

import { draftHasTerminalChips, freezeComposerTransportPayload } from './composer'

describe('terminal references written as literal source', () => {
  it.each([
    '```txt\n    @terminal:`sample:1-4`  \n```\n',
    '| protocol | value |\n| --- | --- |\n| terminal | @terminal:`sample:1-4` |\n',
    '    @terminal:`sample:1-4`\n'
  ])('does not resolve source text as a missing terminal attachment: %s', source => {
    expect(draftHasTerminalChips(source)).toBe(false)
    expect(freezeComposerTransportPayload(source, {})).toEqual({
      displayText: source,
      missingLabels: [],
      transportText: source
    })
  })

  it('freezes a real terminal chip without rewriting adjacent literal source', () => {
    const source =
      '```txt\n\t@terminal:`sample:1-4`  \n\n```\n\n' +
      '| protocol | value |\n| --- | --- |\n| terminal | @terminal:`sample:1-4`  |\n\n' +
      '    @terminal:`sample:1-4`  \n'

    const draft = `  compare  @terminal:\`live:1-2\`  now  \n\n${source}`

    expect(freezeComposerTransportPayload(draft, { 'live:1-2': 'selected terminal lines' })).toEqual({
      displayText: draft,
      missingLabels: [],
      transportText: `\`\`\`terminal\nselected terminal lines\n\`\`\`\n\ncompare now\n\n${source}`
    })
  })
})
