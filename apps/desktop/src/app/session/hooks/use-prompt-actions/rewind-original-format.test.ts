import { describe, expect, it } from 'vitest'

import { type ChatMessage, textPart } from '@/lib/chat-messages'

import { planReload, planRestore } from './rewind'

const user = (text: string): ChatMessage => ({ id: 'user-formatted', role: 'user', parts: [textPart(text)] })

describe('replaying a formatted user turn', () => {
  it.each(['reload', 'restore'] as const)('keeps the original code and table text when planning a %s', action => {
    const source = '\n    code  \n\tvalue\n\n| model | count |\n| --- | --- |\n| Aino | 85 |\n\n'
    const message = user(source)
    const plan = action === 'reload' ? planReload([message], null) : planRestore([message], message.id)

    expect(plan?.text).toBe(source)
    expect(plan?.sourceText).toBe(source.trim())
  })

  it('retains the fallback text boundaries while rejecting whitespace-only replay targets', () => {
    const message = user('   \n')
    const fallback = '    recovered code  \n\n'

    expect(planRestore([message], message.id, { text: fallback }).text).toBe(fallback)
    expect(planReload([message], null)).toBeNull()
    expect(() => planRestore([message], message.id)).toThrow()
  })
})
