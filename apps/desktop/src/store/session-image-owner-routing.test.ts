import { afterEach, expect, it, vi } from 'vitest'

import { preparePlatformSessionRequest } from '@/api/platform-session-binding'
import { requestGatewayForAgent, retainGatewayForSessionTurn } from '@/store/gateway'

import { requestForSessionProfile } from './session-request-router'

vi.mock('@/api/platform-session-binding', () => ({ preparePlatformSessionRequest: vi.fn() }))
vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn(),
  retainGatewayForSessionTurn: vi.fn()
}))
vi.mock('@/store/session-gone-latch', () => ({ resetBackgroundPollingGuardAfterRebind: vi.fn() }))

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.clearAllMocks()
})

it('passes the immutable target profile to image prep while the ticket uses the owning socket profile', async () => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { platformModels: {} } })
  vi.mocked(retainGatewayForSessionTurn).mockResolvedValue(vi.fn())
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ status: 'complete' })
  const owner = { connectionId: 'remote', profile: 'gateway', targetProfile: 'writer' }
  const params = { session_id: 'runtime', prompt: 'hello' }
  const pending = requestForSessionProfile(owner, vi.fn(), 'prompt.submit', params)
  owner.targetProfile = 'changed-after-dispatch'
  await pending
  expect(preparePlatformSessionRequest).toHaveBeenCalledWith(
    { connectionId: 'remote', profile: 'gateway', targetProfile: 'writer' },
    'prompt.submit',
    params,
    expect.any(Function)
  )
  const request = vi.mocked(preparePlatformSessionRequest).mock.calls[0][3]
  await request('session.managed_model_ticket', { session_id: 'runtime' }, 10_000)
  expect(requestGatewayForAgent).toHaveBeenLastCalledWith(
    'remote',
    'gateway',
    'session.managed_model_ticket',
    { session_id: 'runtime' },
    10_000
  )
})
