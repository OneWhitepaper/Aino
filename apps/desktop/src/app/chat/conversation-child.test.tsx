// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import * as gateway from '@/store/gateway'

import { ConversationChild } from './conversation-child'

const owner = { connectionId: 'remote-A', installId: 'install', conversationId: 'conversation' }

const coordinates = {
  conversation_id: owner.conversationId,
  participant_id: 'A',
  session_generation: 2,
  runtime_id: 'runtime-A',
  turn_id: 'turn-A',
  task_id: 'task-A',
  execution_generation: 1
}

const participant = { participant_id: 'A', install_id: 'install', profile: 'profile-A', display_name: 'A' }
const child = { subagent_id: 'child-A', goal: 'Research', status: 'running' as const, accepting_steer: true }
const refresh = vi.fn(async () => {})

function setup(generation = 2) {
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
      participants: [
        { conversation_id: owner.conversationId, participant, session_generation: generation, lineage_id: null }
      ],
      active_turn: null,
      pending_delegations: []
    },
    runtimes: {
      A: {
        available: true,
        runtime_id: coordinates.runtime_id,
        subagents: [child],
        open_requests: [],
        activity: coordinates,
        background_activities: []
      }
    }
  })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ConversationChild child={child} coordinates={coordinates} owner={owner} participantName="A" refresh={refresh} />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $conversationRuntime.set({})
  vi.restoreAllMocks()
})
it('steers and stops the captured runtime child without using an ambient selected profile', async () => {
  const rpc = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockImplementation(async (_connection, _profile, method) =>
      method === 'subagent.steer' ? { status: 'queued' } : { found: true }
    )

  setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for this subagent' }), {
    target: { value: 'Review sources' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
  await screen.findByText('Queued for the next checkpoint')
  expect(rpc).toHaveBeenCalledWith('remote-A', 'default', 'subagent.steer', {
    session_id: 'runtime-A',
    subagent_id: 'child-A',
    text: 'Review sources'
  })
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith('remote-A', 'default', 'subagent.interrupt', {
      session_id: 'runtime-A',
      subagent_id: 'child-A'
    })
  )
})
it('retains steer text and refuses a stale generation without sending a control', async () => {
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent')
  setup(3)
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for this subagent' }), {
    target: { value: 'Keep instruction' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Steer' }))
  await screen.findByText('Conversation runtime changed; refresh before responding')
  expect(rpc).not.toHaveBeenCalled()
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep instruction')
})
