import { describe, expect, it } from 'vitest'

import {
  editGroupMentions,
  groupMentionDisplayOffset,
  projectGroupMentions,
  replaceGroupMentionRange
} from './group-chat-mentions'

const identities = [
  { handle: 'u6d4b-u8bd5', label: '测试' },
  { handle: 'writer-two', label: '测试' },
  { handle: 'designer', label: 'Visual Designer' }
]

describe('readable mention projection', () => {
  it('only projects exact seated addresses and leaves email, unknown and longer handles intact', () => {
    const raw = 'Contact a@designer or @designer-extra. @missing @u6d4b-u8bd5 和 @designer'
    const projection = projectGroupMentions(raw, identities)
    expect(projection.text).toBe('Contact a@designer or @designer-extra. @missing @测试 和 @Visual Designer')
    expect(projection.spans.map(span => span.handle)).toEqual(['u6d4b-u8bd5', 'designer'])
    expect(projection.raw).toBe(raw)
  })

  it('keeps duplicated names bound to their respective addresses across edits elsewhere', () => {
    const original = projectGroupMentions('@u6d4b-u8bd5 and @writer-two', identities)
    expect(original.text).toBe('@测试 and @测试')
    const edited = editGroupMentions(original, `Hello ${original.text}!`, original.text.length + 7)
    // This is two edits at once: bindings within the replaced range are deliberately discarded.
    expect(edited.raw).toBe('Hello @测试 and @测试!')
    const appended = editGroupMentions(original, original.text + ' help', original.text.length + 5)
    expect(appended.raw).toBe('@u6d4b-u8bd5 and @writer-two help')
    const prefixed = editGroupMentions(original, 'Hello ' + original.text, 6)
    expect(prefixed.raw).toBe('Hello @u6d4b-u8bd5 and @writer-two')
  })

  it('drops the binding when its visible name is edited instead of guessing a new recipient', () => {
    const original = projectGroupMentions('@u6d4b-u8bd5 hello @writer-two', identities)
    const edited = editGroupMentions(original, '@测试者 hello @测试', 4)
    expect(edited.raw).toBe('@测试者 hello @writer-two')
    expect(projectGroupMentions(edited.raw, identities).text).toBe('@测试者 hello @测试')
  })

  it('uses the edit location to distinguish removing either of two identical visible names', () => {
    const original = projectGroupMentions('@u6d4b-u8bd5 @writer-two', identities)
    expect(editGroupMentions(original, '@测试', 0).raw).toBe('@writer-two')
    expect(editGroupMentions(original, '@测试', 3).raw).toBe('@u6d4b-u8bd5')
    const replaceFirst = editGroupMentions(original, '@测试 @测试', 3, { start: 0, end: 3 })
    expect(replaceFirst.raw).toBe('@测试 @writer-two')
  })

  it('inserts and removes exact addresses using visible selections', () => {
    const original = projectGroupMentions('Please @u6d4b-u8bd5 help', identities)
    const insertion = replaceGroupMentionRange(original, original.text.length, original.text.length, ' @designer ')
    expect(insertion.raw).toBe('Please @u6d4b-u8bd5 help @designer ')
    const display = projectGroupMentions(insertion.raw, identities)
    expect(groupMentionDisplayOffset(display, insertion.rawCaret)).toBe(display.text.length)
    const removal = replaceGroupMentionRange(original, 7, 10, '')
    expect(removal.raw).toBe('Please  help')
  })

  it('relabels a retained draft after rename without mutating its canonical identity', () => {
    const raw = '@u6d4b-u8bd5 help'
    const renamed = projectGroupMentions(raw, [{ handle: 'u6d4b-u8bd5', label: 'New Name' }])
    expect(renamed.text).toBe('@New Name help')
    expect(editGroupMentions(renamed, renamed.text + ' now', renamed.text.length + 4).raw).toBe(raw + ' now')
    // Losing this room member must not borrow a same-name bot's identity.
    expect(projectGroupMentions(raw, [{ handle: 'different-source', label: 'New Name' }]).text).toBe(raw)
  })
})
