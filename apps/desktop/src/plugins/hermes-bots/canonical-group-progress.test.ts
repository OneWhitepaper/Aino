import { expect, it } from 'vitest'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { canonicalCompletedReplies } from './canonical-group-progress'

const binding = { connectionId: 'local', profile: 'default', roomId: 'room' }
const source: CanonicalGroupEvent = { seq: 1, room_id: 'room', event_id: 'user-one', kind: 'message.user', payload: { text: 'Review', thread_id: 'thread' } }
const coordinates = { discussion_event_id: 'user-one', thread_id: 'thread', member_id: 'reviewer', task_id: 'task-one' }
const message: CanonicalGroupEvent = { seq: 2, room_id: 'room', event_id: 'reply', kind: 'message.member', actor: { kind: 'member', id: 'reviewer' }, payload: { ...coordinates, text: 'Done' } }
const settled: CanonicalGroupEvent = { seq: 3, room_id: 'room', event_id: 'settled', kind: 'turn.settled', payload: { ...coordinates, message_event_id: 'reply', passed: false } }

it('counts a committed response once across out-of-order replay pages and duplicate task receipts', () => {
  expect(canonicalCompletedReplies([settled, source, message, settled, { ...settled, seq: 4, event_id: 'duplicate-receipt' }], binding)).toBe(1)
})

it('never counts a pass, uncommitted message, mismatched author, foreign room or foreign thread as a reply', () => {
  const events = [source, message,
    { ...settled, payload: { ...settled.payload, passed: true } },
    { ...settled, seq: 4, event_id: 'another-member', payload: { ...settled.payload, member_id: 'someone-else' } },
    { ...settled, seq: 5, event_id: 'other-thread', payload: { ...settled.payload, thread_id: 'elsewhere' } },
    { ...settled, seq: 6, event_id: 'foreign-room', room_id: 'other' }
  ]

  expect(canonicalCompletedReplies(events, binding)).toBe(0)
  expect(canonicalCompletedReplies([source, settled], binding)).toBe(0)
})

it('starts a fresh count for a newer user message in the same thread', () => {
  const next = { ...source, seq: 4, event_id: 'user-two' }
  expect(canonicalCompletedReplies([source, message, settled, next], binding)).toBe(0)
})

it('omits a single-message total while multiple threads are unfinished, then follows the remaining thread', () => {
  const other = { ...source, seq: 4, event_id: 'user-two', payload: { ...source.payload, thread_id: 'another-thread' } }
  const ended: CanonicalGroupEvent = { seq: 5, kind: 'room.activity', payload: { discussion_event_id: 'user-two', thread_id: 'another-thread', status: 'settled' } }
  expect(canonicalCompletedReplies([source, message, settled, other], binding)).toBeUndefined()
  expect(canonicalCompletedReplies([source, message, settled, other, ended], binding)).toBe(1)
})

it('does not guess totals from a legacy log without discussion identity', () => {
  expect(canonicalCompletedReplies([{ seq: 1, kind: 'message.user', payload: { text: 'Old log' } }, settled], binding)).toBeUndefined()
  expect(canonicalCompletedReplies([], binding)).toBeUndefined()
})
