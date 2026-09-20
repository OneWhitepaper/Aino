// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'

import { ConversationActivity } from './conversation-activity'

const owner = { connectionId: 'host', installId: 'install', conversationId: 'conversation' }

const coordinates = {
  conversation_id: owner.conversationId,
  participant_id: 'A',
  runtime_id: 'runtime-A',
  session_generation: 2,
  execution_generation: 1,
  turn_id: 'turn-A',
  task_id: 'task-A'
}

afterEach(() => {
  cleanup()
  $conversationDrafts.set({})
})
it('retains a fast completed child and its origin when no live snapshot child remains and the next target is B', () => {
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'B',
    text: 'Next question',
    attachmentIds: [],
    revision: 0
  })
  const runtime = conversationRuntime(owner)
  runtime.activities = {
    A: {
      coordinates,
      lastSeq: 3,
      text: '',
      events: [
        {
          type: 'subagent.start',
          payload: {
            subagent_id: 'fast-child',
            task_count: 1,
            task_index: 0,
            goal: 'Check citations',
            model: 'child-model',
            status: 'running'
          }
        },
        {
          type: 'subagent.tool',
          payload: {
            subagent_id: 'fast-child',
            task_count: 1,
            task_index: 0,
            goal: 'Check citations',
            tool_name: 'terminal'
          }
        },
        {
          type: 'subagent.complete',
          payload: {
            subagent_id: 'fast-child',
            task_count: 1,
            task_index: 0,
            goal: 'Check citations',
            status: 'completed',
            summary: 'Citations checked'
          }
        }
      ]
    }
  }
  runtime.runtimes = {
    A: {
      available: true,
      runtime_id: 'runtime-A',
      subagents: [],
      open_requests: [],
      activity: coordinates,
      background_activities: []
    }
  }

  const { container } = render(
    <I18nProvider configClient={null} initialLocale="en">
      <div>Next responder: B</div>
      <ConversationActivity
        owner={owner}
        participantName={id => `Expert ${id}`}
        refresh={async () => {}}
        respond={vi.fn()}
        runtime={runtime}
      />
    </I18nProvider>
  )

  expect(screen.getByText('Expert A · Subagent · completed')).toBeTruthy()
  expect(screen.getByText('Citations checked')).toBeTruthy()
  expect(screen.getByText('child-model · terminal')).toBeTruthy()
  expect(
    container.querySelector('[data-subagent-id="fast-child"]')?.closest('[data-turn-id]')?.getAttribute('data-turn-id')
  ).toBe('turn-A')
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull()
})
