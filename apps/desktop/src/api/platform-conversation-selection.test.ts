import { afterEach, expect, it, vi } from 'vitest'

import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { platformAccountActions } from './platform'
import { preparePlatformSessionRequest } from './platform-session-binding'

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
  $sessionStates.set({})
})

it('applies a conversation selection on its existing session before binding and submitting, without changing profile defaults', async () => {
  const account = platformSnapshot()
  const owner = { user_id: 'user-a', platform_origin: 'https://aino.test' }
  const calls: string[] = []
  const selected = { model_id: 'deepseek', model_source: 'aino', provider: 'aino', owner }

  const desktop = {
    accountAdapter: 'platform',
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: {
      list: async () => [platformModel('deepseek')],
      owner: async () => owner,
      bind: vi.fn(async () => {
        calls.push('bind')

        return { ok: true }
      }),
      clear: vi.fn()
    }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  $sessionStates.set({ live: { model: 'previous', provider: 'aino' } as never })

  const request = vi.fn(async (method: string) => {
    calls.push(method)

    if (method === 'model.session') {
      return { selection: selected }
    }

    if (method === 'model.options') {
      return { providers: [], session_info: { model_id: 'previous', model_source: 'aino', provider: 'aino' } }
    }

    if (method === 'session.model') {
      return { model: 'deepseek', provider: 'aino' }
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'ticket' }
    }

    if (method === 'config.get') {
      return { value: null }
    }
    throw new Error(`Unexpected ${method}`)
  })

  await preparePlatformSessionRequest(
    { connectionId: 'owned', profile: 'bot' },
    'session.summary',
    { session_id: 'live' },
    request as never
  )
  expect(calls).toEqual(['model.session', 'model.options', 'session.model', 'session.managed_model_ticket', 'bind'])
  expect(request).toHaveBeenCalledWith('session.model', {
    session_id: 'live',
    payload: { model: 'deepseek', model_source: 'aino' }
  })
  expect($sessionStates.get().live).toMatchObject({
    provider: 'aino',
    model: 'deepseek',
    platformModel: {
      modelId: 'deepseek',
      ownerUserId: 'user-a',
      platformOrigin: 'https://aino.test',
      status: 'ready'
    }
  })
})

it('refuses a saved selection from another account without changing or binding the current session', async () => {
  const account = platformSnapshot()

  const desktop = {
    accountAdapter: 'platform',
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: {
      list: async () => [platformModel('deepseek')],
      owner: async () => ({ user_id: 'user-a', platform_origin: 'https://aino.test' }),
      bind: vi.fn(),
      clear: vi.fn()
    }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  const request = vi.fn(async () => ({
    selection: {
      model_id: 'deepseek',
      model_source: 'aino',
      owner: { user_id: 'user-b', platform_origin: 'https://aino.test' }
    }
  }))
  await expect(
    preparePlatformSessionRequest('bot', 'session.summary', { session_id: 'live' }, request as never)
  ).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(request).toHaveBeenCalledOnce()
  expect(desktop.platformModels.bind).not.toHaveBeenCalled()
})

it('retries the accepted target after a binding failure without repeating a committed model mutation', async () => {
  const account = platformSnapshot()
  const owner = { user_id: 'user-a', platform_origin: 'https://aino.test' }
  let committed = false
  const bind = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_binding_failed' } })
    .mockResolvedValue({ ok: true })

  const desktop = {
    accountAdapter: 'platform',
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: { list: async () => [platformModel('deepseek')], owner: async () => owner, bind, clear: vi.fn() }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  $sessionStates.set({ live: { model: 'old', provider: 'aino' } as never })

  const request = vi.fn(async (method: string) => {
    if (method === 'model.session') {
      return { selection: { model_id: 'deepseek', model_source: 'aino', owner } }
    }

    if (method === 'model.options') {
      return {
        providers: [],
        session_info: { provider: 'aino', model_source: 'aino', model_id: committed ? 'deepseek' : 'old' }
      }
    }

    if (method === 'session.model') {
      committed = true

      return { model: 'deepseek' }
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'ticket' }
    }
    throw new Error(`Unexpected ${method}`)
  })

  await expect(
    preparePlatformSessionRequest('bot', 'session.summary', { session_id: 'live' }, request as never)
  ).rejects.toMatchObject({ code: 'gateway_binding_failed' })
  await preparePlatformSessionRequest('bot', 'session.summary', { session_id: 'live' }, request as never)
  expect(request.mock.calls.filter(call => call[0] === 'session.model')).toHaveLength(1)
  expect(bind).toHaveBeenCalledTimes(2)
  expect($sessionStates.get().live).toMatchObject({ model: 'deepseek', platformModel: { status: 'ready' } })
})
