import { beforeEach, expect, it } from 'vitest'

import { clearSessionDraft, stashSessionDraft, takeSessionDraft } from '@/store/composer'

import { recoverHandoffDraft } from './handoff-draft'

const handoff = { source_session_id: 'source', summary: 'Reviewed plan', files: ['src/app.ts'] }
const snapshot = { message_count: 0, messages: [], info: { handoff } }

beforeEach(() => {
  clearSessionDraft('child')
  clearSessionDraft('fresh-child')
})

it('recovers a never-written empty child draft from durable handoff provenance', () => {
  expect(recoverHandoffDraft('fresh-child', snapshot)).toBe(true)
  expect(takeSessionDraft('fresh-child')).toEqual({ text: 'Reviewed plan\n\nsrc/app.ts', attachments: [] })
})

it('never overwrites edited text, attachments or an intentionally cleared draft', () => {
  stashSessionDraft('child', 'My intentional draft', [])
  expect(recoverHandoffDraft('child', snapshot)).toBe(false)
  expect(takeSessionDraft('child').text).toBe('My intentional draft')
  clearSessionDraft('child')
  expect(recoverHandoffDraft('child', snapshot)).toBe(false)
  stashSessionDraft('child', '', [{ id: 'file', kind: 'file', label: 'Notes', path: '/notes.md' }])
  expect(recoverHandoffDraft('child', snapshot)).toBe(false)
  expect(takeSessionDraft('child').attachments).toHaveLength(1)
})

it('does not restore handoff text after any message was admitted or when count is unknown', () => {
  expect(recoverHandoffDraft('fresh-child', { ...snapshot, message_count: 1 })).toBe(false)
  expect(recoverHandoffDraft('fresh-child', { info: { handoff } })).toBe(false)
})
