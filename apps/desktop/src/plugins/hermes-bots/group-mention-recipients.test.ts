import { describe, expect, it } from 'vitest'

import { canonicalMentionRecipients } from './group-mention-recipients'

const members = [
  { handle: 'Alpha', label: '设计师' },
  { handle: 'beta', label: '设计师' },
  { handle: 'writer:one', label: 'Writer' }
]

describe('canonical delivery recipients', () => {
  it.each([
    ['(@ALPHA) help', ['Alpha']],
    ['email@alpha', ['Alpha']],
    ['`@alpha`', ['Alpha']],
    ['```text\n@BETA\n```', ['beta']],
    ['@alpha中文', ['Alpha']],
    ['@writer:one', ['writer:one']],
    ['@unknown @BETA @beta @ALPHA', ['Alpha', 'beta']],
    ['@alpha @all-extra', ['Alpha']]
  ] as const)('reflects gateway addressing even in prose-adjacent text: %s', (text, handles) => {
    expect(canonicalMentionRecipients(text, members)).toEqual({ handles, all: false })
  })

  it.each(['Hello', '@设计师 help', '@Writer help', '@alpha-extra', '@alpha.', '@writerone', '@unknown'])(
    'uses all members when no exact handle matches: %s',
    text => {
      expect(canonicalMentionRecipients(text, members)).toEqual({
        handles: ['Alpha', 'beta', 'writer:one'],
        all: true
      })
    }
  )

  it.each(['@alpha @EVERYONE', '@beta email@ALL', '`@everyone` @writer:one'])(
    'lets an exact broadcast override individual recipients: %s',
    text => {
      expect(canonicalMentionRecipients(text, members)).toEqual({
        handles: ['Alpha', 'beta', 'writer:one'],
        all: true
      })
    }
  )

  it('keeps same-name recipients separate while deduplicating their frozen addresses', () => {
    expect(canonicalMentionRecipients('@beta @ALPHA @alpha', members)).toEqual({
      handles: ['Alpha', 'beta'],
      all: false
    })
    expect(canonicalMentionRecipients('', [...members, { handle: 'ALPHA', label: 'Renamed' }])).toEqual({
      handles: ['Alpha', 'beta', 'writer:one'],
      all: true
    })
  })

  it('has no effective recipients for an empty roster', () => {
    expect(canonicalMentionRecipients('@everyone', [])).toEqual({ handles: [], all: true })
  })
})
