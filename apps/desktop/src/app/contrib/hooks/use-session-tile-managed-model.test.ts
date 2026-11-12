import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import { platformModelCatalog } from '@/store/platform-models'
import { setSessionOwnerHint } from '@/store/session'
import { dropSessionState, publishSessionState, sessionTileDelegate } from '@/store/session-states'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { clearSingleFlightSessionResumeState } from '../../session/hooks/use-prompt-actions/single-flight-resume'

import { useSessionTileDelegate } from './use-session-tile-delegate'

vi.mock('@/hermes', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'stored-managed-bot' }))
}))
vi.mock('@/api/platform-image-session-binding', () => ({ preparePlatformImageSession: vi.fn() }))
vi.mock('@/store/gateway', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

const { requestGatewayForAgent } = await import('@/store/gateway')
const runtimeId = 'runtime-managed-bot'
const storedId = 'stored-managed-bot'
const route = { connectionId: 'local', profile: 'fresh-bot' }
const owner = { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }

afterEach(() => {
  clearSingleFlightSessionResumeState()
  dropSessionState(runtimeId)
  Reflect.deleteProperty(window, 'hermesDesktop')
})

function installTile(initial?: ClientSessionState) {
  const states = { current: new Map(initial ? [[runtimeId, initial]] : []) }
  const bindings = { current: new Map(initial ? [[storedId, runtimeId]] : []) }

  const updateSessionState = vi.fn(
    (id: string, updater: (state: ClientSessionState) => ClientSessionState, stored?: string) => {
      const next = updater(states.current.get(id) ?? createClientSessionState(stored ?? storedId))
      states.current.set(id, next)
      bindings.current.set(next.storedSessionId!, id)
      publishSessionState(id, next)

      return next
    }
  )

  setSessionOwnerHint(storedId, route)

  renderHook(() =>
    useSessionTileDelegate({
      archiveSession: vi.fn(),
      branchLoadedSession: vi.fn(),
      branchStoredSession: vi.fn(),
      executeSlashCommand: vi.fn(),
      removeSession: vi.fn(),
      requestGateway: vi.fn(),
      runtimeIdByStoredSessionIdRef: bindings,
      sessionStateByRuntimeIdRef: states,
      updateSessionState
    } as never)
  )

  return states
}

it('restores a cold bot model owner and rebinds it before the first prompt', async () => {
  const account = platformSnapshot()
  const calls: string[] = []

  const bind = vi.fn(async () => {
    calls.push('native.bind')

    return { ok: true, ready: true, model_id: 'catalog-a', billing_source: 'aino', expires_at: 'later' }
  })

  const desktop = {
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => undefined },
    platformModels: { list: async () => [platformModel()], owner: async () => owner, bind }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  vi.mocked(requestGatewayForAgent).mockImplementation(async (_connection, _profile, method) => {
    calls.push(method)

    if (method === 'session.resume') {
      return {
        session_id: runtimeId,
        messages: [],
        info: {
          provider: 'aino',
          model: 'wire-model',
          model_source: 'aino',
          model_id: 'catalog-a',
          model_status: 'awaiting_managed_credentials',
          platform_owner: owner
        }
      } as never
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'fresh-ticket' } as never
    }

    if (method === 'prompt.submit') {
      return { status: 'accepted' } as never
    }
    throw new Error(`Unexpected request: ${method}`)
  })
  const states = installTile()
  const delegate = sessionTileDelegate()!

  expect(await delegate.resumeTile(storedId)).toBe(runtimeId)
  await expect(delegate.submitToSession(runtimeId, 'Continue after restart')).resolves.toMatchObject({
    runtimeSessionId: runtimeId
  })
  expect(states.current.get(runtimeId)).toMatchObject({
    model: 'catalog-a',
    provider: 'aino',
    platformModel: {
      modelId: 'catalog-a',
      ownerUserId: owner.user_id,
      platformOrigin: owner.platform_origin,
      status: 'awaiting_managed_credentials'
    }
  })
  expect(calls).toEqual(['session.resume', 'session.managed_model_ticket', 'native.bind', 'prompt.submit'])
  expect(bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: 'local',
      profile: 'fresh-bot',
      session_id: runtimeId,
      model_id: 'catalog-a'
    })
  )
})

it('clears an old managed selection when an authoritative tile resume reports a custom model', async () => {
  const initial = {
    ...createClientSessionState(storedId),
    provider: 'aino',
    model: 'catalog-a',
    platformModel: {
      modelId: 'catalog-a',
      ownerUserId: owner.user_id,
      platformOrigin: owner.platform_origin,
      status: 'ready' as const
    }
  }

  vi.mocked(requestGatewayForAgent).mockResolvedValue({
    session_id: runtimeId,
    messages: [],
    info: { provider: 'custom:local', model: 'local-model' }
  } as never)
  const states = installTile(initial)

  await sessionTileDelegate()!.resumeTile(storedId, { authoritativeSnapshot: true })
  expect(states.current.get(runtimeId)).toMatchObject({
    model: 'local-model',
    provider: 'custom:local',
    platformModel: null
  })
})
