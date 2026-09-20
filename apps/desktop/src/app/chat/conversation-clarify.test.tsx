import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $conversationRuntime } from '@/store/conversation-runtime'
import * as gateway from '@/store/gateway'
import { ConversationClarify } from './conversation-clarify'

vi.mock('./conversation-runtime-controls', () => ({ requireConversationRuntime: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  $conversationRuntime.set({})
})
it('uses the original batch choices while preserving replay locks and sequential owner requests', async () => {
  const owner = { connectionId: 'captured', installId: 'installation', conversationId: 'conversation' }
  const request = {
    id: 'request',
    method: 'clarify',
    coordinates: {
      conversation_id: 'conversation',
      participant_id: 'writer',
      session_generation: 1,
      runtime_id: 'runtime',
      turn_id: 'turn',
      task_id: 'task',
      execution_generation: 1
    },
    params: {
      questions: [
        { qid: 'one', question: 'First question', choices: ['Alpha', 'Beta'] },
        { qid: 'two', question: 'Second question', choices: ['Gamma', 'Delta'] }
      ],
      answers: { one: 'Alpha' }
    }
  }
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({ status: 'ok' } as never)
  const respond = vi.fn()
  render(
    <ConversationClarify
      owner={owner}
      request={request}
      respond={respond}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: /Gamma/ }))
  fireEvent.click(screen.getByRole('button', { name: /Confirm and continue/ }))
  await waitFor(() => expect(rpc).toHaveBeenCalledOnce())
  expect(rpc).toHaveBeenCalledWith('captured', 'default', 'clarify.lock', {
    request_id: 'request',
    question_id: 'two',
    answer: 'Gamma'
  })
  expect(respond).not.toHaveBeenCalled()
})

it('keeps a failed owned cancellation available for retry', async () => {
  const respond = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce(undefined)
  render(
    <ConversationClarify
      owner={{ connectionId: 'captured', installId: 'installation', conversationId: 'conversation' }}
      request={{
        id: 'cancel-request',
        method: 'clarify',
        coordinates: {
          conversation_id: 'conversation',
          participant_id: 'writer',
          session_generation: 1,
          runtime_id: 'runtime',
          turn_id: 'turn',
          task_id: 'task',
          execution_generation: 1
        },
        params: { questions: [{ qid: 'one', question: 'Choose a drink', choices: ['Tea', 'Coffee'] }] }
      }}
      respond={respond}
      refresh={vi.fn().mockResolvedValue(undefined)}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Skip/ }))
  await waitFor(() => expect((screen.getByRole('button', { name: /^Skip/ }) as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByText('Choose a drink')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Skip/ })).toBeNull())
  expect(respond.mock.calls).toEqual([
    ['cancel-request', {}],
    ['cancel-request', {}]
  ])
})
