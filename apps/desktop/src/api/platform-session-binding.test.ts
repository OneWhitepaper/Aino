import { afterEach, expect, it, vi } from 'vitest'

import { platformModelCatalog } from '@/store/platform-models'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountBridge, PlatformAccountSnapshot } from '../../shared/platform-contract'

import { platformAccountActions } from './platform'
import { createPlatformDraft } from './platform-session-binding'

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('binds on the owning chat socket before exposing a ready draft and keeps keys out of the result', async () => {
  const account = platformSnapshot()
  const order: string[] = []

  const desktop = {
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
    platformModels: {
      list: async () => [platformModel()],
      owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }),
      bind: async () => {
        order.push('bind')

        return { ok: true, ready: true, model_id: 'catalog-a', billing_source: 'aino', expires_at: 'later' }
      },
      clear: vi.fn()
    }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()

  const request = vi.fn(async (method: string) => {
    order.push(method)

    if (method === 'session.create') {
      return {
        session_id: 'live',
        info: {
          model_source: 'aino',
          model_id: 'catalog-a',
          provider: 'aino',
          model_status: 'awaiting_managed_credentials'
        }
      }
    }

    if (method === 'session.managed_model_ticket') {
      return { managed_model_binding: 1, session_ticket: 'ticket' }
    }
    throw new Error('unexpected request')
  })

  const created = await createPlatformDraft(
    request as never,
    { model_source: 'aino', model_id: 'catalog-a' },
    'user-a',
    { connectionId: 'local', profile: 'work' },
    {
      account,
      owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }
    }
  )

  expect(order).toEqual(['session.create', 'session.managed_model_ticket', 'bind'])
  expect(created.info).toMatchObject({
    model_id: 'catalog-a',
    model_status: 'ready',
    platform_owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }
  })
  expect(desktop.platformModels.clear).not.toHaveBeenCalled()
  expect(request.mock.calls.find(([method]) => method === 'config.set')).toBeUndefined()
})

it('closes a created draft instead of binding it to a newer same-user authority', async () => {
  let snapshot: PlatformAccountSnapshot = { ...platformSnapshot(), mode: 'development' }
  let changed!: (next: PlatformAccountSnapshot) => void
  const created = deferred<{ session_id: string; info: Record<string, unknown> }>()
  const calls: string[] = []

  const desktop = {
    platformAccount: {
      status: async () => snapshot,
      capabilities: async () => ({}) as never,
      retry: async () => snapshot,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: (listener: typeof changed) => {
        changed = listener

        return () => undefined
      }
    } satisfies PlatformAccountBridge,
    platformModels: {
      list: async () => [platformModel()],
      owner: async () => ({
        user_id: 'user-a',
        platform_origin: snapshot.mode === 'development' ? 'http://127.0.0.1:7001' : 'https://api.agentera.com.cn'
      }),
      bind: vi.fn(),
      clear: vi.fn()
    }
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
  await platformAccountActions(desktop.platformAccount).refresh()
  await platformModelCatalog().load()

  const captured = { account: snapshot, owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' } }

  const request = vi.fn(async (method: string) => {
    calls.push(method)

    if (method === 'session.create') {
      return created.promise
    }

    if (method === 'session.close') {
      return {}
    }

    if (method === 'session.managed_model_ticket') {
      throw new Error('must not mint a newer authority ticket')
    }
    throw new Error(`unexpected ${method}`)
  })

  const pending = createPlatformDraft(
    request as never,
    { model_source: 'aino', model_id: 'catalog-a' },
    'user-a',
    { connectionId: 'local', profile: 'work' },
    captured
  )

  await Promise.resolve()
  snapshot = { ...platformSnapshot('user-a', 2), mode: 'production' }
  changed(snapshot)
  created.resolve({
    session_id: 'created-under-a',
    info: {
      model_source: 'aino',
      model_id: 'catalog-a',
      provider: 'aino',
      model_status: 'awaiting_managed_credentials'
    }
  })

  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(calls).toEqual(['session.create', 'session.close'])
  expect(desktop.platformModels.bind).not.toHaveBeenCalled()
  expect(desktop.platformModels.clear).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'keeps a profile-only draft binding and cleanup on its creation profile (rejected=%s)',
  async rejected => {
    const account = platformSnapshot()
    const platformOwner = { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }

    const bind = vi.fn(async () =>
      rejected
        ? { ok: false, error: { code: 'gateway_binding_failed' } }
        : { ok: true, ready: true, model_id: 'catalog-a', billing_source: 'aino', expires_at: 'later' }
    )

    const clear = vi.fn()

    const desktop = {
      platformAccount: {
        status: async () => account,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()], owner: async () => platformOwner, bind, clear }
    }

    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: desktop })
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
    await platformModelCatalog().load()
    const params = { profile: 'fixture-workspace', model_source: 'aino', model_id: 'catalog-a' }

    const request = vi.fn(async (method: string) => {
      if (method === 'session.create') {
        return { session_id: 'profile-session', info: { model_source: 'aino', model_id: 'catalog-a' } }
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'profile-ticket' }
      }

      if (method === 'session.close') {
        return {}
      }
      throw new Error(`unexpected ${method}`)
    })

    const pending = createPlatformDraft(request as never, params, 'user-a', null, { account, owner: platformOwner })

    if (rejected) {
      await expect(pending).rejects.toMatchObject({ code: 'gateway_binding_failed' })
      expect(clear).toHaveBeenCalledWith({ connection_id: '', profile: params.profile, session_id: 'profile-session' })
    } else {
      await expect(pending).resolves.toMatchObject({ info: { model_status: 'ready' } })
      expect(clear).not.toHaveBeenCalled()
    }

    expect(request).toHaveBeenCalledWith('session.create', params)
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({ connection_id: '', profile: params.profile, session_id: 'profile-session' })
    )
  }
)
