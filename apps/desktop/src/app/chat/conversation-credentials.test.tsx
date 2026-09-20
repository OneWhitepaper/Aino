import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { stubResizeObserver } from '@/test/jsdom'
vi.mock('./conversation-runtime-controls', () => ({ requireConversationRuntime: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))
import { notifyError } from '@/store/notifications'

import { ConversationPendingRequest } from './conversation-pending-request'
import { requireConversationRuntime } from './conversation-runtime-controls'
stubResizeObserver()
const owner = { connectionId: 'captured', installId: 'installation', conversationId: 'conversation' }

const coordinates = {
  conversation_id: 'conversation',
  participant_id: 'writer',
  session_generation: 2,
  runtime_id: 'runtime',
  turn_id: 'turn',
  task_id: 'task',
  execution_generation: 3
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it.each(['sudo', 'secret', 'vault.unlock_prompt', 'vault.save_login', 'vault.code'])(
  'uses the original %s form and responds only to its captured request',
  async method => {
    const respond = vi.fn()
    render(
      <ConversationPendingRequest
        owner={owner}
        refresh={vi.fn()}
        request={{
          id: 'owned',
          method,
          coordinates,
          params: {
            site: 'example.test',
            origin: 'https://example.test',
            env_var: 'SERVICE_KEY',
            display_name: 'Vault'
          }
        }}
        respond={respond}
      />
    )
    const inputs = [...document.querySelectorAll('input')]

    for (const input of inputs) {
      fireEvent.change(input, {
        target: {
          value:
            input.autocomplete === 'username'
              ? '  user@example.test  '
              : method === 'vault.code'
                ? '123-456'
                : 'secret-value'
        }
      })
    }

    fireEvent.submit(inputs[0].closest('form')!)
    await waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(requireConversationRuntime).toHaveBeenCalledWith(owner, coordinates)
    expect(respond).toHaveBeenCalledWith('owned', {
      value:
        method === 'vault.save_login'
          ? JSON.stringify({ identifier: 'user@example.test', password: 'secret-value' })
          : method === 'vault.code'
            ? '123456'
            : 'secret-value'
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
)
it('keeps a failed owned cancellation retryable without exposing transport error secrets', async () => {
  const respond = vi
    .fn()
    .mockRejectedValueOnce(new Error('backend echoed secret-value'))
    .mockResolvedValueOnce(undefined)

  render(
    <ConversationPendingRequest
      owner={owner}
      refresh={vi.fn()}
      request={{ id: 'retry', method: 'secret', coordinates, params: {} }}
      respond={respond}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
  )
  expect(String(vi.mocked(notifyError).mock.calls[0]?.[0])).not.toContain('secret-value')
  expect(document.body.textContent).not.toContain('backend echoed')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(respond.mock.calls).toEqual([
    ['retry', { value: '' }],
    ['retry', { value: '' }]
  ])
})
