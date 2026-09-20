// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $conversationAttachments } from '@/store/conversation-attachments'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationDrafts, $conversationRecords, cacheConversation, setConversationDraft } from '@/store/conversations'
import * as gateway from '@/store/gateway'

import { ConversationComposer } from './conversation-composer'

const owner = { connectionId: 'host', installId: 'install', conversationId: 'conversation' }
const key = conversationOwnerKey(owner)
const general = { participant_id: 'G', install_id: 'install', profile: 'default', display_name: 'General', is_general: true }
const options = [{ id: 'G', displayName: 'General', sourceLabel: 'default', isGeneral: true }, { id: 'A', displayName: 'Expert A', sourceLabel: 'writer', isGeneral: false }]
afterEach(() => { cleanup(); $conversationAttachments.set({}); $conversationDrafts.set({}); $conversationRecords.set({}); vi.restoreAllMocks() })
it('keeps attachments through responder selection, permits attachment-only send and removes the selected attachment explicitly', async () => {
  setConversationDraft(owner, { conversationId: owner.conversationId, selectedParticipantId: 'G', text: '', attachmentIds: [], revision: 0 })
  cacheConversation(owner, { conversation_id: owner.conversationId, general, title: 'test', project: null, revision: 0, archived: false })
  vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation(async (_host, _profile, method) => method === 'conversations.capabilities' ? { max_attachment_bytes: 1024, max_attachments: 128 } : { attachment: { id: 'attachment', filename: 'notes.txt', content_ref: { id: 'content', sha256: 'a'.repeat(64), size_bytes: 5, mime_type: 'text/plain' } } })
  const submit = vi.fn()
  render(<I18nProvider configClient={null} initialLocale="en"><ConversationComposer busy={false} onSubmit={submit} owner={owner} participants={options} submitting={false} unavailable={false} /></I18nProvider>)
  fireEvent.change(screen.getByLabelText('Attach', { selector: 'input' }), { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Choose responder with @' }))
  fireEvent.click(screen.getByRole('option', { name: /Expert A/ }))
  expect(screen.getByText('notes.txt')).toBeTruthy()
  expect($conversationDrafts.get()[key]).toMatchObject({ selectedParticipantId: 'A', attachmentIds: ['attachment'], text: '' })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(submit).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }))
  expect($conversationDrafts.get()[key].attachmentIds).toEqual([])
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
})
