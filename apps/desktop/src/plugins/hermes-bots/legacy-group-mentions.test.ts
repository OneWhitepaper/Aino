import { expect, it } from 'vitest'

import {
  legacyGroupMentionScope,
  legacyGroupRecipientNames,
  unresolvedLegacyGroupMentions
} from './legacy-group-mentions'
import type { GroupMember } from './types'

const members: GroupMember[] = [
  { name: 'builder', handle: 'build-a', display_name: '测试', previous_names: ['old-builder'], connectionId: 'local' },
  { name: 'reviewer', handle: 'review-b', display_name: '测试', connectionId: 'studio', remoteSource: true }
]

it('binds clipboard scope to the room, exact source and addresses while ignoring names and seat order', () => {
  const scope = legacyGroupMentionScope('Team', members)
  expect(legacyGroupMentionScope('Team', [...members].reverse())).toBe(scope)
  expect(
    legacyGroupMentionScope(
      'Team',
      members.map(member => ({ ...member, display_name: 'Renamed' }))
    )
  ).toBe(scope)
  expect(legacyGroupMentionScope('Another room', members)).not.toBe(scope)
  expect(legacyGroupMentionScope('Team', [{ ...members[0], connectionId: 'other' }, members[1]])).not.toBe(scope)
  expect(legacyGroupMentionScope('Team', [{ ...members[0], handle: 'new-address' }, members[1]])).not.toBe(scope)
  expect(legacyGroupMentionScope('Team', [{ ...members[0], targetProfile: 'other-profile' }, members[1]])).not.toBe(
    scope
  )
  const owner = { connectionId: 'local', profile: 'default' }
  const bareMembers = [{ name: 'builder', handle: 'build-a' }]
  expect(legacyGroupMentionScope('id:room-a', bareMembers, owner)).not.toBe(
    legacyGroupMentionScope('id:room-b', bareMembers, owner)
  )
  expect(legacyGroupMentionScope('Team', bareMembers, owner)).not.toBe(
    legacyGroupMentionScope('Team', bareMembers, { ...owner, connectionId: 'other' })
  )
  expect(legacyGroupMentionScope('Team', bareMembers, owner)).not.toBe(
    legacyGroupMentionScope('Team', bareMembers, { ...owner, profile: 'other' })
  )
})

it('rejects unbound readable names and stale recipients but preserves aliases resolved by the existing legacy parser', () => {
  const unresolved = (text: string, seated = members) =>
    unresolvedLegacyGroupMentions(text, seated, {}, '所有成员', '你')

  expect(unresolved('@测试 请回复')).toHaveLength(1)
  expect(unresolved('＠测试 请回复')).toHaveLength(1)
  expect(unresolved('@build-a 请回复')).toEqual([])
  expect(unresolved('@old-builder 请回复')).toEqual([])
  expect(unresolved('@everyone 请回复')).toEqual([])
  expect(unresolved('@user 请回复')).toEqual([])
  expect(unresolved('@build-a 请回复', [members[1]])).toHaveLength(1)
  expect(unresolved('代码 `@不存在`\n```\n@不存在\n```')).toEqual([])
})

it('counts same-name recipients without merging their identities into one implied recipient', () => {
  expect(legacyGroupRecipientNames('@build-a @review-b review', members, {}, '所有成员')).toBe('测试 ×2')
  expect(legacyGroupRecipientNames('@build-a review', members, {}, '所有成员')).toBe('测试')
  expect(legacyGroupRecipientNames('@everyone review', members, {}, '所有成员')).toBe('所有成员')
})
