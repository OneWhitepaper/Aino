import { expect, it, vi } from 'vitest'

import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, $conversationRecords, setConversationDraft } from '@/store/conversations'

import { selectConversationExpert } from './composer/expert-selection'
import { changeConversationProject } from './conversation-project-actions'

it('keeps project through A/B selection and keeps expert/text through exact-source generation transition', async () => {
  const owner = { connectionId: 'remote', installId: 'host', conversationId: 'book' }
  const key = conversationOwnerKey(owner)

  const project = {
    install_id: 'host',
    registration_profile: 'writer',
    project_id: 'source',
    cwd: '/book',
    execution_environment_id: 'local'
  }

  const general = {
    participant_id: 'general',
    install_id: 'host',
    profile: 'default',
    display_name: 'General',
    is_general: true
  }

  const record = { conversation_id: 'book', title: 'Book', general, project, revision: 4, archived: false }
  $conversationRuntime.set({})
  $conversationRecords.set({ [key]: record })
  setConversationDraft(owner, {
    conversationId: 'book',
    selectedParticipantId: 'A',
    text: 'Keep this draft',
    attachmentIds: ['file'],
    revision: 4
  })
  const participants = ['A', 'B'].map(id => ({ id, displayName: id, sourceLabel: id, isGeneral: false }))
  selectConversationExpert({ owner, participants }, 'B')
  expect($conversationRecords.get()[key].project).toEqual(project)
  const next = { ...project, registration_profile: 'reviewer', project_id: 'other', cwd: '/other' }

  const request = vi
    .fn()
    .mockResolvedValue({ conversation: { ...record, project: next, revision: 5 }, participants: [] })

  const load = vi.fn().mockResolvedValue(undefined)
  await changeConversationProject(owner, next, 4, load, request)
  expect(request).toHaveBeenCalledWith('remote', 'default', 'conversations.set_project', {
    conversation_id: 'book',
    project_ref: next,
    expected_revision: 4
  })
  expect($conversationDrafts.get()[key]).toMatchObject({
    selectedParticipantId: 'B',
    text: 'Keep this draft',
    attachmentIds: ['file'],
    revision: 5
  })
  expect(load).toHaveBeenCalledOnce()
  request.mockRejectedValueOnce(new Error('stale revision'))
  await expect(changeConversationProject(owner, project, 4, load, request)).rejects.toThrow('stale revision')
  expect($conversationRecords.get()[key].project).toEqual(next)
})
