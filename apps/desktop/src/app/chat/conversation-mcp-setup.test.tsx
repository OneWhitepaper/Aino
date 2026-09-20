// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as hermes from '@/hermes'
import { I18nProvider } from '@/i18n'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import * as gateway from '@/store/gateway'

import { ConversationMcpSetup } from './conversation-mcp-setup'

const owner = { connectionId: 'mcp-owner', installId: 'install', conversationId: 'conversation' }

const coordinates = {
  conversation_id: owner.conversationId,
  participant_id: 'A',
  session_generation: 2,
  runtime_id: 'runtime-A',
  turn_id: 'turn-A',
  task_id: 'task-A',
  execution_generation: 1
}

const participant = { participant_id: 'A', install_id: 'install', profile: 'expert-A', display_name: 'A' }
const respond = vi.fn()

function setup() {
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
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ConversationMcpSetup
        owner={owner}
        refresh={async () => {}}
        request={{ id: 'mcp', method: 'mcp.setup', params: { action: 'enable', server: 'files' }, coordinates }}
        respond={respond}
      />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $conversationRuntime.set({})
  vi.restoreAllMocks()
  respond.mockClear()
})
it('reports enabled only after the scoped mutation, keeping the running tool schema pinned', async () => {
  let finish!: (result: { ok: boolean }) => void

  const enable = vi.spyOn(hermes, 'setMcpServerEnabled').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )

  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({})
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
  expect(enable).toHaveBeenCalledWith('files', true, { connectionId: 'mcp-owner', profile: 'expert-A' })
  expect(respond).not.toHaveBeenCalled()
  finish({ ok: true })
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith('mcp', {
      value: JSON.stringify({
        server: 'files',
        status: 'enabled',
        detail:
          'New tools will be used after you refresh this expert’s configuration or start a new conversation. This turn keeps its current tools.'
      })
    })
  )
  expect(rpc).not.toHaveBeenCalled()
})
it('reports a real installation error rather than a false success and permits decline without a mutation', async () => {
  const enable = vi.spyOn(hermes, 'setMcpServerEnabled').mockRejectedValue(new Error('server unavailable'))
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith('mcp', {
      value: JSON.stringify({ server: 'files', status: 'error', detail: 'server unavailable' })
    })
  )
  cleanup()
  respond.mockClear()
  enable.mockClear()
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(enable).not.toHaveBeenCalled()
  expect(respond).toHaveBeenCalledWith('mcp', { value: JSON.stringify({ server: 'files', status: 'declined' }) })
})

it('surfaces an expired request after async failure without rejecting the detached click handler', async () => {
  vi.spyOn(hermes, 'setMcpServerEnabled').mockRejectedValue(new Error('Enable failed'))
  respond.mockImplementation(() => {
    throw new Error('Request expired')
  })
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Request expired')
  expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(false)
  respond.mockReset()
})
