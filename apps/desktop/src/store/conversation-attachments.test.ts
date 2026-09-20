// @vitest-environment jsdom
import { waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as gateway from '@/store/gateway'

import {
  $conversationAttachments,
  removeConversationAttachment,
  uploadConversationAttachment
} from './conversation-attachments'
import { conversationOwnerKey } from './conversation-owner'
import { $conversationDrafts, setConversationDraft } from './conversations'

const owner = { connectionId: 'upload-host', installId: 'install', conversationId: 'conversation' }
const key = conversationOwnerKey(owner)

const attachment = {
  id: 'attached',
  filename: 'notes.txt',
  content_ref: { id: 'content', sha256: 'a'.repeat(64), size_bytes: 5, mime_type: 'text/plain' }
}

function draft() {
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'A',
    text: 'Keep this text',
    attachmentIds: [],
    revision: 1
  })
}

afterEach(() => {
  $conversationDrafts.set({})
  $conversationAttachments.set({})
  vi.restoreAllMocks()
})
it('freezes upload ownership before reading files and merges attachment into the latest expert draft without losing edits', async () => {
  draft()
  let resolve!: (result: unknown) => void

  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation((_host, _profile, method) =>
    method === 'conversations.capabilities'
      ? Promise.resolve({ max_attachment_bytes: 1024, max_attachments: 128 })
      : new Promise(done => {
          resolve = done
        })
  )

  const mutableOwner = { ...owner }
  const pending = uploadConversationAttachment(mutableOwner, new File(['hello'], 'notes.txt', { type: 'text/plain' }))
  mutableOwner.connectionId = 'other-host'
  mutableOwner.conversationId = 'other-conversation'
  await waitFor(() => expect(rpc.mock.calls.some(call => call[2] === 'conversations.attach')).toBe(true))
  setConversationDraft(owner, {
    ...$conversationDrafts.get()[key],
    selectedParticipantId: 'B',
    text: 'Edited while uploading'
  })
  expect(rpc).toHaveBeenCalledWith('upload-host', 'default', 'conversations.attach', {
    conversation_id: 'conversation',
    filename: 'notes.txt',
    mime_type: 'text/plain',
    data_base64: btoa('hello')
  })
  resolve({ attachment })
  await pending
  expect($conversationDrafts.get()[key]).toMatchObject({
    selectedParticipantId: 'B',
    text: 'Edited while uploading',
    attachmentIds: ['attached']
  })
  expect(Object.keys($conversationAttachments.get())).toEqual([key])
})
it('retains failed attachment and text for retry and never reattaches a removed in-flight upload', async () => {
  draft()
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockRejectedValue(new Error('Upload unavailable'))
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  await uploadConversationAttachment(owner, file)
  const item = $conversationAttachments.get()[key][0]
  expect(item).toMatchObject({ status: 'error', error: 'Upload unavailable' })
  expect($conversationDrafts.get()[key]).toMatchObject({ text: 'Keep this text', attachmentIds: [] })
  let resolve!: (result: unknown) => void
  rpc.mockImplementation((_host, _profile, method) =>
    method === 'conversations.capabilities'
      ? Promise.resolve({ max_attachment_bytes: 1024, max_attachments: 128 })
      : new Promise(done => {
          resolve = done
        })
  )
  const pending = uploadConversationAttachment(owner, file, item.localId)
  await waitFor(() => expect(rpc.mock.calls.some(call => call[2] === 'conversations.attach')).toBe(true))
  removeConversationAttachment(owner, item.localId)
  resolve({ attachment })
  await pending
  expect($conversationAttachments.get()[key]).toEqual([])
  expect($conversationDrafts.get()[key].attachmentIds).toEqual([])
})
