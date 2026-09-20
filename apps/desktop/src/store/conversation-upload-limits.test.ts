// @vitest-environment jsdom
import { waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import {
  $conversationAttachments,
  $conversationUploadErrors,
  removeConversationAttachment,
  uploadConversationAttachment
} from './conversation-attachments'
import { conversationOwnerKey } from './conversation-owner'
import { $conversationDrafts, setConversationDraft } from './conversations'
import * as gateway from './gateway'

const owner = { connectionId: 'host', installId: 'install', conversationId: 'conversation' }
const key = conversationOwnerKey(owner)

function setup() {
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'A',
    text: 'Retain draft',
    attachmentIds: [],
    revision: 0
  })
}

afterEach(() => {
  $conversationDrafts.set({})
  $conversationAttachments.set({})
  $conversationUploadErrors.set({})
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('rejects oversized files against the captured backend limit before reading or uploading any bytes', async () => {
  setup()
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')

  const rpc = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockResolvedValue({ max_attachment_bytes: 4, max_attachments: 128 })

  await uploadConversationAttachment(owner, new File(['12345'], 'too-large.txt'))
  expect(read).not.toHaveBeenCalled()
  expect(rpc).toHaveBeenCalledExactlyOnceWith('host', 'default', 'conversations.capabilities', {})
  expect($conversationAttachments.get()[key][0]).toMatchObject({ status: 'error' })
  expect($conversationDrafts.get()[key].text).toBe('Retain draft')
})
it('serializes byte reads per connection and aborts/removes a read without issuing its upload RPC', async () => {
  setup()
  const readers: TestReader[] = []

  class TestReader {
    result = 'data:text/plain;base64,aGVsbG8='
    onload?: () => void
    onerror?: () => void
    onabort?: () => void
    readAsDataURL() {
      readers.push(this)
    }
    abort() {
      this.onabort?.()
    }
  }
  vi.stubGlobal('FileReader', TestReader)

  const rpc = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockImplementation(async (_host, _profile, method) =>
      method === 'conversations.capabilities'
        ? { max_attachment_bytes: 1024, max_attachments: 128 }
        : { attachment: { id: 'second', filename: 'second.txt', content_ref: { id: 'content', size_bytes: 5 } } }
    )

  const first = uploadConversationAttachment(owner, new File(['hello'], 'first.txt'))
  const second = uploadConversationAttachment(owner, new File(['hello'], 'second.txt'))
  await waitFor(() => expect(readers).toHaveLength(1))
  expect(rpc.mock.calls.filter(call => call[2] === 'conversations.attach')).toHaveLength(0)
  removeConversationAttachment(owner, $conversationAttachments.get()[key][0].localId)
  await first
  await waitFor(() => expect(readers).toHaveLength(2))
  readers[1].onload?.()
  await second
  const uploads = rpc.mock.calls.filter(call => call[2] === 'conversations.attach')
  expect(uploads).toHaveLength(1)
  expect(uploads[0][3]?.filename).toBe('second.txt')
  expect($conversationDrafts.get()[key].attachmentIds).toEqual(['second'])
})

it('does not read without advertised bounds and caps combined accepted plus pending selections before queueing bytes', async () => {
  setup()
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ max_attachments: 128 })
  await uploadConversationAttachment(owner, new File(['hello'], 'unsupported.txt'))
  expect(read).not.toHaveBeenCalled()
  expect($conversationAttachments.get()[key][0].status).toBe('error')
  removeConversationAttachment(owner, $conversationAttachments.get()[key][0].localId)
  setConversationDraft(owner, {
    ...$conversationDrafts.get()[key],
    attachmentIds: Array.from({ length: 128 }, (_, index) => `accepted-${index}`)
  })
  rpc.mockClear()
  await uploadConversationAttachment(owner, new File(['hello'], 'overflow.txt'))
  expect(rpc).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect($conversationAttachments.get()[key]).toEqual([])
  expect($conversationUploadErrors.get()[key]).toContain('Too many attachments')
  expect($conversationDrafts.get()[key].text).toBe('Retain draft')
})
