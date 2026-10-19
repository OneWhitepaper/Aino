import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { createSessionRpcDispatcher } from '@/app/contrib/session-rpc-dispatcher'
import { desktopSessionCreateParams } from '@/app/session/hooks/use-session-actions/create-params'
import { group } from '@/components/pane-shell/tree/model'
import { $activeTreeGroup, $layoutTree } from '@/components/pane-shell/tree/store'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { requestGatewayForAgent, setPrimaryGatewayConnectionId } from './gateway'
import { $onboardingPhase } from './onboarding-phase'
import { startPlatformOnboarding } from './onboarding-platform'
import { noteOnboardingEnded, reconcileOnboarding, skipOnboarding, startOnboarding } from './onboarding-run'
import { $onboardingSession } from './onboarding-session'
import { platformModelCatalog } from './platform-models'
import { $newChatRoute, ensureGatewayAgent } from './profile'
import { $selectedStoredSessionId, setSessionOwnerHint } from './session'

vi.mock('./gateway', async original => ({ ...(await original<Record<string, unknown>>()), requestGatewayForAgent: vi.fn() }))
vi.mock('./profile', async original => ({ ...(await original<Record<string, unknown>>()), ensureGatewayAgent: vi.fn(async () => {}) }))

vi.mock('@/app/session/hooks/use-session-actions/create-params', () => ({ desktopSessionCreateParams: vi.fn() }))
afterEach(() => { Reflect.deleteProperty(window, 'hermesDesktop'); vi.clearAllMocks(); $activeTreeGroup.set(null); $layoutTree.set(null); $onboardingSession.set(null); setPrimaryGatewayConnectionId(null) })

async function accountFixture(bind: () => Promise<unknown>) {
  const account = platformSnapshot()
  const owner = { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: {
    accountAdapter: 'platform',
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: { list: async () => [platformModel()], owner: async () => owner, bind }
  } })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  vi.mocked(desktopSessionCreateParams).mockResolvedValue({
    params: { model_source: 'aino', model_id: 'catalog-a' }, platformOwner: owner.user_id,
    platformAuthority: { account, owner }
  })

  return owner
}

it('binds the managed onboarding runtime before the backend may submit its opening turn', async () => {
  const order: string[] = []

  const owner = await accountFixture(async () => { order.push('bind');

 return { ok: true } })

  const request = vi.fn(async (method: string) => {
    order.push(method)

    if (method === 'session.managed_model_ticket') { return { managed_model_binding: 1, session_ticket: 'ticket' } }

    return { session_id: 'live', stored_session_id: 'stored', run_id: 'run', managed_model_pending: order.length === 1 }
  })

  const result = await startPlatformOnboarding(request as never, { fresh_launch: true, locale: 'zh' })
  expect(order).toEqual(['onboarding.start', 'session.managed_model_ticket', 'bind', 'onboarding.start'])
  expect(request.mock.calls[0]).toEqual(['onboarding.start', {
    fresh_launch: true, locale: 'zh', model_source: 'aino', model_id: 'catalog-a', platform_owner: owner
  }, undefined])
  expect(request.mock.calls[2]).toEqual(['onboarding.start', {
    fresh_launch: false, rerun: false, locale: 'zh', model_source: 'aino', model_id: 'catalog-a', platform_owner: owner
  }, undefined])
  expect(result.managed_model_pending).toBe(false)
})

it('does not submit the opening turn when managed binding fails', async () => {
  await accountFixture(async () => ({ ok: false, error: { code: 'insufficient_balance' } }))

  const request = vi.fn(async (method: string) => method === 'session.managed_model_ticket'
    ? { managed_model_binding: 1, session_ticket: 'ticket' }
    : { session_id: 'live', managed_model_pending: true })

  await expect(startPlatformOnboarding(request as never, {})).rejects.toMatchObject({ code: 'insufficient_balance' })
  expect(request.mock.calls.filter(([method]) => method === 'onboarding.start')).toHaveLength(1)
})


it('keeps start, ticket, native binding, resume and late lifecycle calls on the captured owner after focus changes', async () => {
  const owner = { connectionId: 'remote-owner', profile: 'default' }

  const nativeBind = vi.fn(async () => {
    $layoutTree.set(group(['session-tile:other-chat'], { id: 'focus', active: 'session-tile:other-chat' }))
    $activeTreeGroup.set('focus')
    setSessionOwnerHint('other-chat', { connectionId: 'other-device', profile: 'work' })

    return { ok: true }
  })

  await accountFixture(nativeBind)
  setPrimaryGatewayConnectionId(owner.connectionId)
  setSessionOwnerHint('focused-chat', { connectionId: 'wrong-device', profile: 'work' })
  $layoutTree.set(group(['session-tile:focused-chat'], { id: 'focus', active: 'session-tile:focused-chat' }))
  $activeTreeGroup.set('focus')
  const ambient = vi.fn(async () => { throw new Error('ambient is not onboarding owner') })

  const dispatch = createSessionRpcDispatcher({
    ambientRequest: ambient,
    runtimeIdByStoredSessionIdRef: { current: new Map() },
    selectedStoredSessionIdRef: { current: 'focused-chat' },
    sessionStateByRuntimeIdRef: { current: new Map() }
  })

  let starts = 0
  vi.mocked(requestGatewayForAgent).mockImplementation(async (_connection, _profile, method) => {
    if (method === 'session.managed_model_ticket') { return { managed_model_binding: 1, session_ticket: 'ticket' } as never }

    if (method === 'onboarding.state') { return { run_id: 'run' } as never }

    return { session_id: 'live', stored_session_id: 'stored', run_id: 'run', managed_model_pending: ++starts === 1 } as never
  })
  await dispatch('onboarding.state')
  expect(requestGatewayForAgent).toHaveBeenCalledWith('wrong-device', 'work', 'onboarding.state', {})
  vi.mocked(requestGatewayForAgent).mockClear()

  const resume = vi.fn(async (id: string) => { $selectedStoredSessionId.set(id) })
  expect(await startOnboarding(dispatch, resume, { owner })).toBe(true)
  expect(ensureGatewayAgent).toHaveBeenCalledWith('remote-owner', 'default')
  expect(desktopSessionCreateParams).toHaveBeenCalledWith('', owner, 'default', false)
  expect(nativeBind).toHaveBeenCalledWith(expect.objectContaining({ connection_id: 'remote-owner', profile: 'default', session_id: 'live' }))
  expect(resume).toHaveBeenCalledWith('stored', true, owner)
  await reconcileOnboarding(dispatch)
  await skipOnboarding(dispatch, 'live')
  expect(requestGatewayForAgent).toHaveBeenCalled()
  expect(vi.mocked(requestGatewayForAgent).mock.calls.every(call => call[0] === 'remote-owner' && call[1] === 'default')).toBe(true)
  expect(ambient).not.toHaveBeenCalled()
})

it('does not bind or resume an onboarding runtime after the account revision changes', async () => {
  await accountFixture(async () => ({ ok: true }))

  const request = vi.fn(async () => {
    Object.assign(window.hermesDesktop.platformAccount, { status: async () => platformSnapshot('user-b', 2) })
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

    return { session_id: 'live', managed_model_pending: true }
  })

  await expect(startPlatformOnboarding(request as never, {}, undefined, () => false, { connectionId: 'owner', profile: 'default' }))
    .rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(request).toHaveBeenCalledTimes(1)
})


it('keeps the skip replacement draft owner when its ended event arrives before the reply', async () => {
  const owner = { connectionId: 'onboarding-device', profile: 'default' }
  const reply = deferred<unknown>()
  $onboardingPhase.set('shown')
  $onboardingSession.set({ owner, connectionId: owner.connectionId, runId: 'run-skip', runtimeId: 'live-skip', storedId: 'stored-skip' })
  vi.mocked(requestGatewayForAgent).mockReturnValue(reply.promise as never)
  const pending = skipOnboarding(vi.fn() as never, 'live-skip')
  noteOnboardingEnded({ outcome: 'skipped', run_id: 'run-skip', stored_session_id: 'stored-skip' })
  expect($onboardingSession.get()).toBeNull()
  setPrimaryGatewayConnectionId('other-device')
  reply.resolve({ ok: true })
  await pending
  expect(requestGatewayForAgent).toHaveBeenCalledWith(owner.connectionId, 'default', 'onboarding.skip', { session_id: 'live-skip' })
  expect($newChatRoute.get()).toEqual(owner)
})
