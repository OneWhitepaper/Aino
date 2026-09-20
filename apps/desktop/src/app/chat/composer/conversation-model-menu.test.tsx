const platformProps = vi.hoisted(() => vi.fn())
vi.mock('@/components/platform-model-list', () => ({
  PlatformModelList: (props: unknown) => {
    platformProps(props)
    return <div>Platform catalog</div>
  }
}))
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as gateway from '@/store/gateway'

import { ConversationApprovalMode } from './conversation-approval-mode'
import { ConversationModelMenu } from './conversation-model-menu'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('reads selected expert configuration through the captured coordinator without activating or spawning its profile gateway', async () => {
  const request = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockImplementation(
      async (_connection, _profile, method) =>
        (method === 'model.options'
          ? { model: 'writer-model', provider: 'writer-provider', providers: [] }
          : { value: 'manual' }) as never
    )
  const owner = { connectionId: 'captured', installId: 'installation', conversationId: 'conversation' }
  const refresh = vi.fn()
  render(
    <>
      <ConversationModelMenu
        owner={owner}
        participantId="writer"
        profile="writer"
        generation={2}
        disabled={false}
        onRefresh={refresh}
      />
      <ConversationApprovalMode
        owner={owner}
        participantId="writer"
        profile="writer"
        disabled={false}
        onRefresh={refresh}
      />
    </>
  )
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('captured', 'default', 'model.options', { profile: 'writer' })
  )
  expect(request).toHaveBeenCalledWith('captured', 'default', 'config.get', {
    key: 'approvals.mode',
    profile: 'writer'
  })
  expect(request.mock.calls.every(call => call[1] === 'default')).toBe(true)
  expect(refresh).not.toHaveBeenCalled()
})

it('restores platform model identity independently from its underlying provider and model', async () => {
  vi.spyOn(gateway, 'requestGatewayForAgent').mockResolvedValue({
    model: 'gpt-underlying',
    provider: 'openai',
    providers: []
  } as never)
  const original = window.hermesDesktop
  window.hermesDesktop = { ...original, platformModels: {} } as typeof original
  const owner = { connectionId: 'captured', installId: 'installation', conversationId: 'conversation' }
  render(
    <ConversationModelMenu
      owner={owner}
      participantId="writer"
      profile="writer"
      generation={2}
      disabled={false}
      model={{ model: 'gpt-underlying', provider: 'openai', model_source: 'aino', model_id: 'platform-choice' }}
      onRefresh={vi.fn()}
    />
  )
  fireEvent.pointerDown(screen.getByRole('button', { name: /model/i }), { button: 0, ctrlKey: false })
  await waitFor(() => expect(platformProps).toHaveBeenCalled())
  expect(platformProps.mock.calls.at(-1)?.[0]).toMatchObject({ selectedId: 'platform-choice' })
  act(() => platformProps.mock.calls.at(-1)?.[0].onSelect({ id: 'platform-next' }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByText('platform-next')).toBeTruthy()
  window.hermesDesktop = original
})
