import { afterEach, beforeEach, expect, it } from 'vitest'

import { canonicalMemberName } from './canonical-group-members'
import {
  $canonicalGroupBindings,
  canonicalGroupAliasKey,
  canonicalGroupMatchesQuery,
  registerCanonicalGroup,
  syncCanonicalGroupName
} from './canonical-group-registry'
import type { CanonicalRoomMember } from './canonical-groups'

beforeEach(() => $canonicalGroupBindings.set({}))
afterEach(() => $canonicalGroupBindings.set({}))

it('finds groups by their current name and member labels without requiring optional metadata', () => {
  const room = {
    name: 'Product planning',
    members: [
      { member_id: 'a', display_name: 'UI Designer', handle: 'design-bot', profile: 'visual-review' },
      { member_id: 'b', profile: 'helper', handle: 'helper' }
    ]
  }

  expect(canonicalGroupMatchesQuery(room, '  PRODUCT  ')).toBe(true)
  expect(canonicalGroupMatchesQuery(room, 'designer')).toBe(true)
  expect(canonicalGroupMatchesQuery(room, 'DESIGN-BOT')).toBe(true)
  expect(canonicalGroupMatchesQuery(room, 'visual-review')).toBe(true)
  expect(canonicalGroupMatchesQuery(room, 'unrelated')).toBe(false)
  expect(canonicalGroupMatchesQuery({ name: 'Empty room', members: [] }, '   ')).toBe(true)
})

it('finds encoded members by the same current name shown in their room without borrowing another connection', () => {
  const profile = 'u6d4b-u8bd5'
  const room = { name: 'Collaboration', members: [{ member_id: 'seat-one', profile, handle: profile, display_name: profile }] }
  const binding = { connectionId: 'studio', profile: 'default', roomId: 'room-one' }

  const roster = [
    { name: profile, connectionId: 'local', display_name: '本机助手' },
    { name: profile, connectionId: 'studio', display_name: '工作室助手' }
  ]

  const nameFor = (member: CanonicalRoomMember) => canonicalMemberName(member, binding, roster, {}, 'local')

  expect(canonicalGroupMatchesQuery(room, '工作室助手', nameFor)).toBe(true)
  expect(canonicalGroupMatchesQuery(room, '本机助手', nameFor)).toBe(false)
  expect(canonicalGroupMatchesQuery(room, profile, nameFor)).toBe(true)
})

it('renames all views of the same room without touching another account, profile or room', () => {
  const route = { connectionId: 'local', profile: 'default' }
  const key = registerCanonicalGroup(route, { room_id: 'one', name: 'Original', members: [] })
  const binding = $canonicalGroupBindings.get()[key]
  const alias = canonicalGroupAliasKey(route, 'Original')
  const otherConnection = { ...binding, connectionId: 'remote' }
  const otherProfile = { ...binding, profile: 'other' }
  const otherRoom = { ...binding, roomId: 'two' }
  $canonicalGroupBindings.set({
    ...$canonicalGroupBindings.get(),
    [alias]: { ...binding },
    remote: otherConnection,
    profile: otherProfile,
    other: otherRoom
  })

  syncCanonicalGroupName(binding, 'Renamed')

  const renamed = $canonicalGroupBindings.get()
  expect(renamed[key]).toEqual({ ...binding, roomName: 'Renamed' })
  expect(renamed[alias]).toEqual({ ...binding, roomName: 'Renamed' })
  expect(renamed.remote).toBe(otherConnection)
  expect(renamed.profile).toBe(otherProfile)
  expect(renamed.other).toBe(otherRoom)
  syncCanonicalGroupName(binding, 'Renamed')
  expect($canonicalGroupBindings.get()).toBe(renamed)
})

it('does not mint a binding when a late room refresh names an already removed room', () => {
  const empty = $canonicalGroupBindings.get()
  syncCanonicalGroupName({ connectionId: 'local', profile: 'default', roomId: 'gone' }, 'Late rename')
  expect($canonicalGroupBindings.get()).toBe(empty)
})
