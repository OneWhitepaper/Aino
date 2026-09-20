import { useStore } from '@nanostores/react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { $conversationPrivateNotices, setConversationPrivateNotice } from '@/store/conversation-notices'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'
import * as gateway from '@/store/gateway'

import { ConversationSlashSuggestions } from './conversation-slash-suggestions'
import { composerPlainText } from './rich-editor'

const owner = { connectionId: 'local', installId: 'host', conversationId: 'rich-store' }
const key = conversationOwnerKey(owner)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Probe() {
  const drafts = useStore($conversationDrafts)
  const notices = useStore($conversationPrivateNotices)
  const runtime = useStore($conversationRuntime)
  const input = useRef<HTMLDivElement>(null)

  return (
    <>
      <div aria-label="Draft" contentEditable data-slot="composer-rich-input" ref={input} role="textbox" />
      <ConversationSlashSuggestions
        generation={1}
        input={input}
        onChange={text => setConversationDraft(owner, { ...$conversationDrafts.get()[key], text })}
        owner={owner}
        profile="default"
        text={drafts[key].text}
      />
      <output>{notices[key]?.output}</output>
      <output>{runtime[key]?.runtimes.general?.model_snapshot?.model}</output>
    </>
  )
}

it('keeps atom-driven model and notice updates live after long multiline rich editing', () => {
  vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ scoped_commands: false } as never)
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'general',
    text: '',
    attachmentIds: [],
    revision: 1
  })
  render(<Probe />)
  const input = screen.getByRole('textbox')
  const text = 'Long editor row\n'.repeat(45)
  act(() => setConversationDraft(owner, { ...$conversationDrafts.get()[key], text }))
  expect(composerPlainText(input)).toBe(text)
  fireEvent.input(input)
  fireEvent.input(input)
  expect($conversationDrafts.get()[key].text).toBe(text)
  act(() => {
    setConversationPrivateNotice(owner, {
      participantId: 'general',
      displayName: 'Aino',
      output: 'Configuration updated'
    })
    updateConversationRuntime(owner, {
      runtimes: {
        general: {
          available: false,
          runtime_id: null,
          subagents: [],
          open_requests: [],
          activity: null,
          background_activities: [],
          model_snapshot: { model: 'alternate', provider: 'custom', model_source: 'byok', model_id: 'alternate' }
        }
      }
    })
  })
  expect(screen.getByText('Configuration updated')).toBeTruthy()
  expect(screen.getByText('alternate')).toBeTruthy()
})
