// @vitest-environment jsdom
import type { ConversationEvent } from '@hermes/shared/gateway-events'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { composerPlainText } from './composer/rich-editor'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

import { I18nProvider } from '@/i18n'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import {
  $conversationDrafts,
  $conversationRecords,
  cacheConversation,
  freezeConversationSend,
  setConversationDraft
} from '@/store/conversations'

const actions = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  participants: vi.fn(),
  releaseIdle: vi.fn(),
  send: vi.fn(async () => {}),
  submit: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  stop: vi.fn(),
  retry: vi.fn(),
  respond: vi.fn()
}))

vi.mock('./conversation-actions', () => ({ createConversationActions: () => actions }))
vi.mock('@/components/chat/compact-markdown', () => ({
  CompactMarkdown: ({ text }: { text: string }) => <p>{text}</p>
}))

const { ConversationView } = await import('./conversation-view')
const owner = { connectionId: 'remote', installId: 'installation', conversationId: 'one-visible-conversation' }
const key = conversationOwnerKey(owner)

const general = {
  participant_id: 'general',
  install_id: owner.installId,
  profile: 'default',
  display_name: 'General Aino',
  is_general: true
}

const expert = (id: string) => ({
  ...general,
  participant_id: id,
  profile: `profile-${id}`,
  display_name: `Expert ${id}`,
  is_general: false
})

const catalog = [general, expert('A'), expert('B')]

const record = {
  conversation_id: owner.conversationId,
  title: 'One shared history',
  general,
  project: null,
  revision: 4,
  archived: false
}

const publicReply = (id: string, text: string, seq: number): ConversationEvent => ({
  room_id: owner.conversationId,
  seq,
  event_id: `event-${seq}`,
  kind: 'conversation.response',
  actor: { kind: 'participant', id, display_name: `Historic ${id}` },
  authority_epoch: 1,
  payload: {
    text,
    status: 'settled',
    model_snapshot: { model: 'actual-model', provider: 'provider', model_source: 'byok' }
  },
  created_at: 0
})

function setup(catalogPromise?: Promise<unknown>) {
  Element.prototype.animate = vi.fn(() => ({
    cancel: vi.fn(),
    finished: Promise.resolve()
  })) as unknown as typeof Element.prototype.animate
  actions.participants.mockResolvedValue(
    catalogPromise ?? {
      participants: catalog.map(participant => ({ participant, available: true }))
    }
  )
  cacheConversation(owner, record)
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: general.participant_id,
    text: '',
    attachmentIds: [],
    revision: 4
  })
  updateConversationRuntime(owner, {
    snapshot: {
      conversation: record,
      participants: catalog.map(participant => ({
        participant,
        conversation_id: owner.conversationId,
        session_generation: 1,
        lineage_id: null
      })),
      active_turn: null,
      pending_delegations: []
    },
    events: [publicReply('A', 'Earlier public answer', 1)]
  })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ConversationView owner={owner} />
    </I18nProvider>
  )
}

async function pick(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Choose responder with @' }))
  fireEvent.click(
    await screen.findByRole('option', { name: new RegExp(id === 'general' ? 'General Aino' : `Expert ${id}`) })
  )
}

afterEach(() => {
  cleanup()
  $conversationDrafts.set({})
  $conversationRecords.set({})
  $conversationRuntime.set({})
  vi.clearAllMocks()
})

it('keeps one attributed history through G → A → B → clear → G → A, with literal @ text remaining text', async () => {
  setup()
  await waitFor(() => expect(actions.participants).toHaveBeenCalled())
  const targets: string[] = []
  actions.submit.mockImplementation(async () => {
    targets.push(
      freezeConversationSend($conversationDrafts.get()[key], { inputId: 'input', turnId: 'turn' }).participantId
    )
  })
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
    target: { textContent: 'Email user@B.example and literal @B' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose responder' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: /Expert A/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await pick('B')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear expert selection' }))
  expect(screen.getByRole('button', { name: 'Choose responder' }).textContent).toContain('General Aino')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await pick('A')
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(targets).toEqual(['general', 'A', 'B', 'general', 'A'])
  expect(screen.getByText('Earlier public answer')).toBeTruthy()
  expect(screen.getByText('Historic A')).toBeTruthy()
  expect(screen.getByText('actual-model · provider · byok')).toBeTruthy()
  expect($conversationDrafts.get()[key].text).toContain('literal @B')
  expect(Object.keys($conversationRecords.get())).toEqual([key])
})

it('selection while A runs edits only the next draft, preserves live tools/child/request owner and stops A', async () => {
  setup()

  const active = {
    turn_id: 'turn-A',
    input_id: 'input-A',
    participant_id: 'A',
    session_generation: 1,
    task_id: 'task-A',
    execution_generation: 2,
    status: 'running' as const,
    runtime_id: 'runtime-A'
  }

  const coordinates = { conversation_id: owner.conversationId, ...active }
  act(() =>
    updateConversationRuntime(owner, {
      busy: true,
      snapshot: { ...$conversationRuntime.get()[key].snapshot!, active_turn: active },
      pendingRequests: {
        approval: { id: 'approval', method: 'approval', params: { command: 'inspect workspace' }, coordinates }
      },
      activities: {
        live: {
          coordinates,
          events: [{ type: 'tool.start', payload: { tool_id: 'tool', name: 'terminal' } }],
          lastSeq: 1,
          text: 'A is working'
        }
      },
      runtimes: {
        A: {
          available: true,
          runtime_id: 'runtime-A',
          model_snapshot: null,
          activity: coordinates,
          background_activities: [],
          open_requests: [],
          subagents: [{ subagent_id: 'child', goal: 'Check references', status: 'running' }]
        }
      }
    })
  )
  await pick('B')
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { textContent: 'Next question' } })
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  expect($conversationRuntime.get()[key].snapshot?.active_turn?.participant_id).toBe('A')
  expect($conversationDrafts.get()[key].selectedParticipantId).toBe('B')
  expect(screen.getByText('A is working')).toBeTruthy()
  expect(screen.getByText('Check references')).toBeTruthy()
  expect(screen.getByLabelText('Expert A · terminal')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Run(?!ning)/ }))
  expect(actions.respond).toHaveBeenCalledWith('approval', { choice: 'once' })
  actions.stop.mockResolvedValue({ status: 'requested' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Stop' }).at(-1)!)
  expect(actions.stop).toHaveBeenCalledWith(active)
  expect(screen.getByText('Earlier public answer')).toBeTruthy()
})

it('keeps a deferred catalog loading state distinct from an unavailable expert on reload', async () => {
  let resolve!: (value: unknown) => void
  setup(
    new Promise(done => {
      resolve = done
    })
  )
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { textContent: 'Retained draft' } })
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => resolve({ participants: [] }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Selected expert unavailable')
  expect(composerPlainText(screen.getByRole('textbox', { name: 'Message' }))).toBe('Retained draft')
})

it('renders private command notices outside the shared log and confirms configuration refresh for the captured expert', async () => {
  setup()
  await waitFor(() => expect(actions.participants).toHaveBeenCalled())
  const { setConversationPrivateNotice, $conversationPrivateNotices } = await import('@/store/conversation-notices')
  act(() => {
    setConversationDraft(owner, {
      ...$conversationDrafts.get()[key],
      selectedParticipantId: 'A',
      text: 'Keep this next reply'
    })
    setConversationPrivateNotice(owner, {
      participantId: 'A',
      displayName: 'Expert A',
      command: '/prompt',
      output: 'Private SOUL text'
    })
  })
  expect(screen.getByText('Private SOUL text').closest('[role="log"]')).toBeNull()
  expect(screen.getByRole('log').textContent).toContain('Earlier public answer')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh expert configuration' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Refresh expert configuration' }).at(-1)!)
  act(() => setConversationDraft(owner, { ...$conversationDrafts.get()[key], selectedParticipantId: 'B' }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => expect(actions.refresh).toHaveBeenCalledWith('A', 1))
  expect($conversationDrafts.get()[key].text).toBe('Keep this next reply')
  expect(actions.submit).not.toHaveBeenCalled()
  $conversationPrivateNotices.set({})
})

it('resizes the original input on programmatic draft updates and clears its height after acknowledgement', async () => {
  setup()
  const input = screen.getByRole('textbox', { name: 'Message' }) as HTMLDivElement
  Object.defineProperty(input, 'scrollHeight', {
    configurable: true,
    get: () => (composerPlainText(input).length > 30 ? 120 : 28)
  })
  act(() =>
    setConversationDraft(owner, {
      ...$conversationDrafts.get()[key],
      text: 'A multiline draft that needs more room than one compact row.'
    })
  )
  await waitFor(() => expect(input.style.height).toBe('120px'))
  act(() => setConversationDraft(owner, { ...$conversationDrafts.get()[key], text: '' }))
  await waitFor(() => expect(input.style.height).toBe('28px'))
})
