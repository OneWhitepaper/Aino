// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import * as gateway from '@/store/gateway'

import { ConversationPendingRequest } from './conversation-pending-request'

const owner = { connectionId: 'request-owner', installId: 'installation', conversationId: 'conversation' }

const coordinates = {
  conversation_id: owner.conversationId,
  participant_id: 'A',
  session_generation: 2,
  runtime_id: 'runtime-A',
  turn_id: 'turn',
  task_id: 'task',
  execution_generation: 1
}

const participant = { participant_id: 'A', install_id: owner.installId, profile: 'profile-A', display_name: 'A' }
const respond = vi.fn()
const refresh = vi.fn(async () => {})

function setup(method: string, params: Record<string, unknown>) {
  updateConversationRuntime(owner, {
    snapshot: {
      conversation: {
        conversation_id: owner.conversationId,
        title: 'test',
        general: participant,
        project: null,
        revision: 1,
        archived: false
      },
      participants: [{ conversation_id: owner.conversationId, participant, session_generation: 2, lineage_id: null }],
      active_turn: null,
      pending_delegations: []
    },
    runtimes: {
      A: {
        available: true,
        runtime_id: coordinates.runtime_id,
        subagents: [],
        open_requests: [],
        activity: coordinates,
        background_activities: []
      }
    }
  })

  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <ConversationPendingRequest
        owner={owner}
        refresh={refresh}
        request={{ id: 'request', method, params, coordinates }}
        respond={respond}
      />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $conversationRuntime.set({})
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
it('preserves replayed batch locks and sequentially locks only new answers over the captured socket; cancel sends no answers', async () => {
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'ok' })

  const params = {
    questions: [
      { qid: 'q0', question: 'Locked answer', choices: ['old'] },
      { qid: 'q1', question: 'Choose environments', choices: ['prod', 'stage'], multi_select: true }
    ],
    answers: { q0: 'old' }
  }

  const view = setup('clarify', params)
  expect(screen.getByText('old')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'prod' }))
  fireEvent.click(screen.getByRole('button', { name: 'stage' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(rpc).toHaveBeenCalledExactlyOnceWith('request-owner', 'default', 'clarify.lock', {
    request_id: 'request',
    question_id: 'q1',
    answer: JSON.stringify(['prod', 'stage'])
  })
  expect(respond).not.toHaveBeenCalled()
  view.unmount()
  setup('clarify', params)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(respond).toHaveBeenCalledWith('request', {})
})
it('keeps vault login credentials in the form, emits canonical JSON, and lets users decline without credentials', () => {
  const view = setup('vault.save_login', { site: 'Example', origin: 'https://example.com' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Email or username' }), { target: { value: 'reader' } })
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'private-password' } })
  expect(screen.queryByText('private-password')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(respond).toHaveBeenCalledWith('request', {
    value: JSON.stringify({ identifier: 'reader', password: 'private-password' })
  })
  view.unmount()
  setup('vault.code', { site: 'Example' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(respond).toHaveBeenLastCalledWith('request', { value: '' })
})
