import { describe, expect, it } from 'vitest'

import { copyGroupMentions, readGroupMentionsClipboard } from './group-chat-mention-clipboard'
import { projectGroupMentions, unresolvedGroupMentions } from './group-chat-mentions'

const scope = JSON.stringify(['canonical', 'connection-a', 'profile', 'room'])

const identities = [
  { handle: 'encoded-a', label: '测试' },
  { handle: 'encoded-b', label: '测试' }
]

describe('scoped mention clipboard metadata', () => {
  it('keeps same-name bindings in metadata while plain text remains readable', () => {
    const projection = projectGroupMentions('@encoded-a 帮忙 @encoded-b', identities)
    const copied = copyGroupMentions(projection, 0, projection.text.length, scope)
    expect(copied.text).toBe('@测试 帮忙 @测试')
    expect(readGroupMentionsClipboard(copied.envelope!, copied.text, scope, identities)).toBe(
      '@encoded-a 帮忙 @encoded-b'
    )
  })

  it('does not carry a binding for partial mention selections or missing authority', () => {
    const projection = projectGroupMentions('@encoded-a hello', identities)
    expect(copyGroupMentions(projection, 1, projection.text.length, scope)).toEqual({ text: '测试 hello' })
    expect(copyGroupMentions(projection, 0, projection.text.length)).toEqual({ text: '@测试 hello' })
  })

  it('accepts the same frozen identity after rename and rejects removed or foreign recipients', () => {
    const projection = projectGroupMentions('@encoded-a', identities)
    const copied = copyGroupMentions(projection, 0, projection.text.length, scope)
    expect(
      readGroupMentionsClipboard(copied.envelope!, copied.text, scope, [{ handle: 'encoded-a', label: '新名称' }])
    ).toBe('@encoded-a')
    expect(
      readGroupMentionsClipboard(copied.envelope!, copied.text, scope, [{ handle: 'encoded-b', label: '测试' }])
    ).toBeUndefined()
    expect(readGroupMentionsClipboard(copied.envelope!, copied.text, scope + 'foreign', identities)).toBeUndefined()
  })

  it('rejects altered plain text, mismatching bindings and malformed envelopes', () => {
    const projection = projectGroupMentions('@encoded-a', identities)
    const copied = copyGroupMentions(projection, 0, projection.text.length, scope)
    expect(readGroupMentionsClipboard(copied.envelope!, '@someone-else', scope, identities)).toBeUndefined()

    for (const serialized of [
      '{',
      'null',
      '[]',
      '0',
      '{"version":1}',
      JSON.stringify({ ...JSON.parse(copied.envelope!), raw: '@encoded-b' })
    ]) {
      expect(readGroupMentionsClipboard(serialized, copied.text, scope, identities)).toBeUndefined()
    }
  })
})

describe('unbound directed-looking text', () => {
  it('flags plain pasted names and unknown addresses without guessing a recipient', () => {
    expect(unresolvedGroupMentions('请 @测试 帮忙，@not-a-member', identities).map(span => span.text)).toEqual([
      '@测试',
      '@not-a-member'
    ])
    expect(unresolvedGroupMentions('请 @测试 帮忙 @not-a-member', identities).map(span => span.text)).toEqual([
      '@测试',
      '@not-a-member'
    ])
    expect(unresolvedGroupMentions('请 @encoded-a 帮忙', identities)).toEqual([])
  })

  it('does not block code examples or email addresses and handles unfinished fences', () => {
    const raw = 'hello a@example.com\n`@unknown`\n```ts\n@missing\n```\n~~~\n@still-code\n~~~\n@测试'
    expect(unresolvedGroupMentions(raw, identities).map(span => span.text)).toEqual(['@测试'])
    expect(unresolvedGroupMentions('```\n@unfinished-code', identities)).toEqual([])
  })

  it('recognizes spaced display names without consuming surrounding prose', () => {
    expect(
      unresolvedGroupMentions('@Visual Designer please help', [{ handle: 'd1', label: 'Visual Designer' }])
    ).toEqual([{ start: 0, end: 16, text: '@Visual Designer' }])
  })

  it('flags recipient-looking names next to punctuation and fullwidth unbound marks', () => {
    expect(unresolvedGroupMentions('(@测试)；＠encoded-a，请@测试', identities).map(span => span.text)).toEqual([
      '@测试',
      '＠encoded-a',
      '@测试'
    ])
    expect(unresolvedGroupMentions('(@encoded-a)', identities)).toEqual([])
  })

  it('validates the full canonical address including colons before allowing a fresh send', () => {
    const seated = [...identities, { handle: 'source:designer', label: '设计师' }]
    expect(unresolvedGroupMentions('(@source:designer) a@encoded-a', seated)).toEqual([])
    expect(unresolvedGroupMentions('@encoded-a:removed', seated).map(span => span.text)).toEqual(['@encoded-a:removed'])
  })
})
