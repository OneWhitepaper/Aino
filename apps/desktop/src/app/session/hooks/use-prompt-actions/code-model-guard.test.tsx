import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getCustomEndpoints } from '@/api/config'
import { getGlobalModelOptions } from '@/api/models'
import { platformAccountActions } from '@/api/platform'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $composerAttachments, $composerDraft } from '@/store/composer'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $routeRequest } from '@/store/recovery-requests'
import { $currentModel, $currentProvider } from '@/store/session'
import { $sessionStates, dropSessionState, publishSessionState } from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { platformSnapshot } from '@/test/platform-model'

import { actRender, Harness, type HarnessHandle, RUNTIME_SESSION_ID } from './index-test-utils'
import { clearSingleFlightSessionResumeState } from './single-flight-resume'

vi.mock('@/api/config', () => ({ getCustomEndpoints: vi.fn() }))
vi.mock('@/api/models', () => ({ getGlobalModelOptions: vi.fn() }))
vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

beforeEach(() => {
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
  vi.mocked(requestGatewayForProfile).mockResolvedValue({ capabilities: [] })
  clearSingleFlightSessionResumeState()
  window.localStorage.removeItem('hermes.desktop.preparedSubmissions.v1')
  window.localStorage.removeItem('hermes.desktop.composerQueue.v1')
  vi.mocked(getGlobalModelOptions).mockResolvedValue({ providers: [] })
  vi.mocked(getCustomEndpoints).mockResolvedValue({ current: { provider: '', model: '', base_url: '' }, endpoints: [] })
  publishSessionState(RUNTIME_SESSION_ID, {
    ...createClientSessionState(),
    executionMode: 'code',
    provider: 'lab',
    model: 'm1'
  })
  $composerDraft.set('Keep my unsent request')
  $composerAttachments.set([
    { id: 'file-1', kind: 'file', label: 'README.md', refText: '@file:README.md', path: 'README.md' }
  ])
})

afterEach(() => {
  cleanup()
  dropSessionState(RUNTIME_SESSION_ID)
  $composerDraft.set('')
  $composerAttachments.set([])
  clearNotifications()
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.clearAllMocks()
})

async function renderGuard(apiMode = 'chat_completions', info?: Promise<unknown>) {
  const create = vi.fn(async () => RUNTIME_SESSION_ID)

  const request = vi.fn(async (method: string) => {
    if (method === 'session.info') {
      return info ?? { provider: 'lab', model: 'm1', api_mode: apiMode }
    }

    return {}
  })

  let handle: HarnessHandle | null = null
  await actRender(
    <Harness
      createBackendSessionForSend={create}
      onReady={value => (handle = value)}
      refreshSessions={async () => undefined}
      requestGateway={request as never}
    />
  )
  // Eager drop-time upload is independent of Send; measure only submission effects.
  request.mockClear()

  return { handle: handle!, request, create }
}

it('refuses an incompatible Code send before admission or attachment upload and keeps the draft with settings recovery', async () => {
  const { handle, request, create } = await renderGuard()
  expect(await handle.submitText('Keep my unsent request')).toBe(false)
  expect(request.mock.calls.map(call => call[0])).toEqual(['session.info'])
  expect(create).not.toHaveBeenCalled()
  expect(handle.state().messages).toEqual([])
  expect($composerDraft.get()).toBe('Keep my unsent request')
  expect($composerAttachments.get()).toHaveLength(1)
  const action = $notifications.get().at(0)?.action
  expect(action?.label).toBe('Model settings')
  act(() => action?.onClick())
  expect($routeRequest.get()?.path).toContain('tab=providers')
})

it('keeps Work sends unchanged even when the foreground model is incompatible with Code', async () => {
  publishSessionState(RUNTIME_SESSION_ID, {
    ...createClientSessionState(),
    executionMode: 'work',
    provider: 'lab',
    model: 'm1'
  })
  $composerAttachments.set([])
  const { handle, request } = await renderGuard()
  expect(await handle.submitText('Work still works')).toBe(true)
  expect(request.mock.calls.map(call => call[0])).toEqual(['prompt.submit'])
})

it('uses the target session model instead of another foreground model', async () => {
  $currentProvider.set('unrelated')
  $currentModel.set('other-model')
  $composerAttachments.set([])
  const { handle, request } = await renderGuard('responses')
  expect(await handle.submitText('use the session route')).toBe(true)
  expect(request.mock.calls.map(call => call[0])).toEqual(['session.info', 'prompt.submit'])
})

it.each(['chat_completions', 'anthropic_messages'])(
  'admits the selected %s Code session through an advertised bridge without changing its model',
  async protocol => {
    vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
    vi.mocked(requestGatewayForProfile).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
    $composerAttachments.set([])
    const { handle, request } = await renderGuard(protocol)
    expect(await handle.submitText('use this model through the adapter')).toBe(true)
    expect(request.mock.calls.map(call => call[0])).toEqual(['session.info', 'prompt.submit'])
    expect($sessionStates.get()[RUNTIME_SESSION_ID]).toMatchObject({ provider: 'lab', model: 'm1' })
  }
)

it('refuses a stale protocol answer when the session model changes during the read', async () => {
  const info = deferred<unknown>()
  const { handle, request } = await renderGuard('responses', info.promise)
  const sent = handle.submitTextRaw('Keep my unsent request')
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('session.info', expect.anything()))
  publishSessionState(RUNTIME_SESSION_ID, { ...$sessionStates.get()[RUNTIME_SESSION_ID], model: 'm2' })
  info.resolve({ provider: 'lab', model: 'm1', api_mode: 'responses' })
  expect(await sent).toBe(false)
  expect(request.mock.calls.map(call => call[0])).toEqual(['session.info'])
  expect($composerDraft.get()).toBe('Keep my unsent request')
})

it('keeps an unknown Code route unverified after metadata lookup without changing its model', async () => {
  $composerAttachments.set([])
  const { handle, request } = await renderGuard('')
  expect(await handle.submitText('send the chosen route')).toBe(true)
  expect(getGlobalModelOptions).toHaveBeenCalled()
  expect(getCustomEndpoints).toHaveBeenCalled()
  expect(request.mock.calls.map(call => call[0])).toEqual(['session.info', 'prompt.submit'])
  expect($sessionStates.get()[RUNTIME_SESSION_ID]).toMatchObject({ provider: 'lab', model: 'm1' })
})

it('refuses a protocol answer belonging to the account that signed out during the read', async () => {
  const status = vi.fn(async () => platformSnapshot('user-a'))
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: { status, capabilities: async () => ({}), onChanged: () => () => undefined },
      platformModels: { list: async () => [] }
    }
  })
  const actions = platformAccountActions(window.hermesDesktop.platformAccount)
  await actions.refresh()
  const info = deferred<unknown>()
  const { handle, request } = await renderGuard('responses', info.promise)
  const sent = handle.submitTextRaw('keep this request')
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('session.info', expect.anything()))
  status.mockResolvedValue(platformSnapshot('user-b', 2))
  await actions.refresh()
  info.resolve({ provider: 'lab', model: 'm1', api_mode: 'responses' })
  expect(await sent).toBe(false)
  expect(request.mock.calls.map(call => call[0])).toEqual(['session.info'])
  expect($composerDraft.get()).toBe('Keep my unsent request')
})
