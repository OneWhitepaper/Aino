import { expect, it, vi } from 'vitest'

const answer = vi.hoisted(() => vi.fn())
vi.mock('@/api/platform-conversation-models', () => ({ answerPlatformConversationModelRequest: answer }))

import { handleServerRequest, type ServerRequestContext } from './server-requests'

it('answers metadata for the originating background session on its captured source instead of the foreground model', async () => {
  const result = { status: 'selected', selection: { model_source: 'aino', model_id: 'deepseek' } }
  answer.mockResolvedValue(result)
  const respond = vi.fn()

  const request = {
    id: 'srq-model',
    method: 'model.session',
    params: { session_id: 'background', action: 'select', query: 'DeepSeek' },
    profile: 'origin-profile',
    connectionId: 'origin-connection',
    respond,
    fail: vi.fn()
  }

  const deps = { sessionStateByRuntimeIdRef: { current: new Map() } } as ServerRequestContext['deps']
  expect(handleServerRequest(request, deps, 'foreground')).toBe(true)
  await vi.waitFor(() => expect(respond).toHaveBeenCalledExactlyOnceWith(result))
  expect(answer).toHaveBeenCalledExactlyOnceWith(
    { profile: 'origin-profile', connectionId: 'origin-connection' },
    { action: 'select', query: 'DeepSeek' }
  )
})
