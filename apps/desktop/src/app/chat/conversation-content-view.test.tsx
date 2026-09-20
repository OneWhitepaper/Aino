// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import * as content from './conversation-content'
import { ConversationContentView } from './conversation-content-view'

vi.mock('@/components/chat/compact-markdown', () => ({
  CompactMarkdown: ({ text }: { text: string }) => <p>{text}</p>
}))
const owner = { connectionId: 'host', installId: 'install', conversationId: 'conversation' }

const event = {
  room_id: 'conversation',
  seq: 1,
  event_id: 'event',
  kind: 'conversation.response',
  actor: { kind: 'participant', id: 'A' },
  authority_epoch: 1,
  payload: {
    text: '',
    content_status: 'referenced',
    content_ref: { id: 'content', sha256: 'a'.repeat(64), size_bytes: 10, mime_type: 'text/plain; charset=utf-8' }
  },
  created_at: 0
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('renders loading, then recoverable error rather than blank success, and renders full content after explicit retry', async () => {
  let reject!: (reason: Error) => void

  const read = vi.spyOn(content, 'readConversationContent').mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ConversationContentView event={event} owner={owner} />
    </I18nProvider>
  )
  expect(screen.getByRole('status').textContent).toContain('Loading full answer')
  reject(new Error('Checksum mismatch'))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Checksum mismatch')
  read.mockResolvedValue(new TextEncoder().encode('Complete original answer including the final paragraph'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByText('Complete original answer including the final paragraph')).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
