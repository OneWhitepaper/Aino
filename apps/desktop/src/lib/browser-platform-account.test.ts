import type { JsonRpcGatewayClient } from '@hermes/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $confirmRequest, settleConfirm } from '@/store/confirm'

import { createPlatformClient } from '../../shared/platform-client'
import type { PlatformModel } from '../../shared/platform-contract'

import { createBrowserPlatformBridge, openBrowserPlatformGateway } from './browser-platform-account'

const model: PlatformModel = {
  id: 'text',
  model: 'text-model',
  display_name: 'Text',
  provider_label: 'Aino',
  purpose: 'chat',
  api_mode: 'chat_completions',
  state: 'available',
  reason_code: null,
  is_default: true,
  context_window: 32000,
  max_output_tokens: 4000,
  capabilities: { tools: true, vision: true, reasoning: true },
  billing_source: 'balance',
  pricing: {
    currency: 'USD',
    unit: 'per_million_tokens',
    input: '1',
    output: '2',
    cache_read: null,
    cache_write: null,
    effective_user_rate: '1',
    detail_available: true,
    tiers: [],
    time_pricing: null,
    group_peak: null
  }
}

const imageModel: PlatformModel = {
  ...model,
  id: 'image',
  model: 'image-model',
  purpose: 'image',
  api_mode: 'images_generations',
  capabilities: {
    tools: false,
    vision: true,
    reasoning: false,
    image_generation: true,
    image_quality_options: ['auto', 'high']
  }
}

const disposers: Array<() => void> = []
afterEach(() => {
  settleConfirm(false)
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function rig(
  options: {
    useDefaultConfirm?: boolean
    captcha?: boolean
    delayCapabilities?: Promise<void>
    claim?: number
    delayLease?: Promise<void>
    profileFails?: boolean
    leaseFails?: boolean
  } = {}
) {
  const apiCalls: Array<{ url: string; body: any; headers: any }> = []
  const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'ok', data }))

  const apiFetch = vi.fn(async (url: any, init: any) => {
    const body = init.body ? JSON.parse(init.body) : null
    apiCalls.push({ url, body, headers: init.headers })

    if (url.endsWith('/settings/public')) {
      await options.delayCapabilities

      return response({
        desktop_api_version: 1,
        phone_code_length: 6,
        turnstile_enabled: options.captcha === true,
        turnstile_site_key: options.captcha ? 'site-key' : ''
      })
    }

    if (url.endsWith('/auth/login')) {
      return response({
        token_type: 'Bearer',
        access_token: 'secret-access',
        refresh_token: 'secret-refresh',
        expires_in: 3600
      })
    }

    if (url.endsWith('/user/profile')) {
      if (options.profileFails) {
        return response({ id: 'invalid-id' })
      }

      return response({ id: 17, username: 'Test Aino account', email: 'test@example.com', phone_bound: false })
    }

    if (url.endsWith('/desktop/models?include_images=true')) {
      return response([model, imageModel])
    }

    if (url.endsWith('/desktop/credentials')) {
      await options.delayLease

      if (options.leaseFails) {
        return new Response(JSON.stringify({ code: 400, reason: 'quota_exhausted', message: 'quota' }), { status: 400 })
      }

      return response({
        purpose: body.purpose ?? 'chat',
        model: body.purpose === 'image' ? imageModel : model,
        credential_id: 'credential',
        api_key: 'inference-secret',
        base_url: 'https://api.agentera.com.cn/v1',
        expires_at: new Date(Date.now() + 300_000).toISOString()
      })
    }

    if (url.endsWith('/desktop/billing-summary')) {
      return response({
        currency: 'USD',
        balance: '5',
        frozen_balance: '1',
        available_balance: '4',
        payment_enabled: true,
        active_subscriptions: [],
        updated_at: new Date().toISOString()
      })
    }

    if (url.endsWith('/auth/logout')) {
      return response({ success: true })
    }
    throw new Error(`Unexpected API call ${url}`)
  })

  const gatewayFetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ticket: 'one-use-ticket' }))
  )
  vi.stubGlobal('fetch', gatewayFetch)

  const request = vi.fn(async (method: string, params: any) => {
    if (method === 'session.claim_managed_model') {
      return {
        managed_model_binding: options.claim ?? 1,
        managed_image_binding: 1,
        managed_model_context_window: true,
        managed_device_key: 1,
        binding_revision: 2
      }
    }

    return { bound: true, model_id: params.model_id, binding_revision: params.binding_revision }
  })

  const close = vi.fn()
  const openGateway = vi.fn(
    async () => ({ request, close, connectionState: 'open' }) as unknown as JsonRpcGatewayClient
  )
  const confirmRemote = vi.fn(async () => true)

  const adapter = createBrowserPlatformBridge({
    bootstrap: { authRequired: true, basePath: '/hermes', privateSession: false, token: '' },
    client: createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl: apiFetch }),
    openGateway,
    ...(options.useDefaultConfirm ? {} : { confirmRemote })
  })

  disposers.push(adapter.dispose)
  const login = () =>
    adapter.bridge.platformAccount.loginExisting({
      email: 'test@example.com',
      password: 'secret-password',
      remember: true
    })

  const bind = async (purpose: 'chat' | 'image' = 'chat', profile = 'secondary') =>
    adapter.bridge.platformModels.bind({
      connection_id: 'local',
      profile,
      session_id: 'session',
      model_id: purpose === 'image' ? 'image' : 'text',
      session_ticket: 'session-ticket',
      expected_account_revision: (await adapter.bridge.platformAccount.status()).revision,
      purpose
    })

  return { ...adapter, apiCalls, apiFetch, gatewayFetch, request, close, openGateway, confirmRemote, login, bind }
}

describe('browser Aino account and gateway authority', () => {
  it.each(['userId', 'mode', 'revision'] as const)('rejects a stale logout owner after %s changes', async field => {
    const test = rig()
    await test.login()
    const snapshot = await test.bridge.platformAccount.status()
    const expected = { userId: snapshot.account!.id, mode: snapshot.mode, revision: snapshot.revision }
    const stale = {
      ...expected,
      [field]: field === 'userId' ? 'other-user' : field === 'mode' ? 'development' : expected.revision - 1
    }

    await expect(test.bridge.platformAccount.logout(stale)).rejects.toMatchObject({ code: 'platform_account_changed' })
    expect(test.apiCalls.some(call => call.url.endsWith('/auth/logout'))).toBe(false)
    expect(await test.bridge.platformAccount.status()).toEqual(snapshot)
  })

  it('allows an owner-matched logout through the existing browser account lifecycle', async () => {
    const test = rig()
    await test.login()
    const snapshot = await test.bridge.platformAccount.status()

    await expect(
      test.bridge.platformAccount.logout({
        userId: snapshot.account!.id,
        mode: snapshot.mode,
        revision: snapshot.revision
      })
    ).resolves.toMatchObject({ phase: 'signed_out', account: null })
    expect(test.apiCalls.filter(call => call.url.endsWith('/auth/logout'))).toHaveLength(1)
  })

  it('never exposes native device reauthorization or obtains permanent keys even from a capable gateway', async () => {
    const test = rig()
    await test.login()
    expect(test.bridge.platformModels).not.toHaveProperty('reauthorize')
    expect(test.bridge.platformModels).not.toHaveProperty('credentialRejected')
    expect((await test.bind()).ok).toBe(true)
    expect(test.apiCalls.filter(call => call.url.endsWith('/desktop/credentials'))).toHaveLength(1)
    expect(test.apiCalls.some(call => call.url.includes('/desktop/device-keys'))).toBe(false)
  })
  it('requires real Aino login, keeps credentials out of storage and retains both catalogs and billing ownership', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const test = rig()
    expect(test.bridge.accountAdapter).toBe('platform')
    expect(await test.bridge.platformAccount.status()).toMatchObject({
      phase: 'signed_out',
      mode: 'production',
      account: null
    })
    await expect(test.bridge.platformModels.list()).rejects.toMatchObject({ code: 'authentication_required' })
    expect(await test.login()).toMatchObject({
      status: 'signed_in',
      snapshot: { remember_state: 'session_only', account: { id: '17' } }
    })
    expect((await test.bridge.platformModels.list()).map(value => value.purpose)).toEqual(['chat', 'image'])
    expect(await test.bridge.platformBilling.summary({ expected_user_id: '17' })).toMatchObject({
      available_balance: '4'
    })
    await expect(test.bridge.platformBilling.summary({ expected_user_id: 'other' })).rejects.toMatchObject({
      code: 'platform_account_changed'
    })
    expect(storage).not.toHaveBeenCalled()
    expect(JSON.stringify(await test.bridge.platformAccount.status())).not.toContain('secret-')
  })

  it('does not authenticate a malformed profile or bypass an enabled native-only CAPTCHA', async () => {
    const invalid = rig({ profileFails: true })
    await expect(invalid.login()).rejects.toMatchObject({ code: 'invalid_response' })
    expect(await invalid.bridge.platformAccount.status()).toMatchObject({ phase: 'signed_out', account: null })
    const captcha = rig({ captcha: true })
    await expect(captcha.login()).rejects.toMatchObject({ code: 'captcha_browser_unavailable' })
    expect(captcha.apiCalls.some(call => call.url.endsWith('/auth/login'))).toBe(false)
    expect(await captcha.bridge.platformAccount.status()).toMatchObject({ phase: 'signed_out' })
  })

  it('does not finish a pending login after the user signs out during the CAPTCHA policy read', async () => {
    let release!: () => void
    const test = rig({
      delayCapabilities: new Promise<void>(resolve => {
        release = resolve
      })
    })
    const login = test.login()
    await vi.waitFor(() => expect(test.apiCalls.some(call => call.url.endsWith('/settings/public'))).toBe(true))
    await test.bridge.platformAccount.logout()
    release()
    await expect(login).rejects.toMatchObject({ code: 'captcha_stale' })
    expect(test.apiCalls.some(call => call.url.endsWith('/auth/login'))).toBe(false)
    expect(await test.bridge.platformAccount.status()).toMatchObject({ phase: 'signed_out' })
  })

  it('proves gateway capability before requesting any inference credential', async () => {
    const test = rig({ claim: 0 })
    await test.login()
    expect(await test.bind()).toEqual({ ok: false, error: { code: 'unsupported_gateway' } })
    expect(test.apiCalls.some(call => call.url.endsWith('/desktop/credentials'))).toBe(false)
    expect(test.close).toHaveBeenCalled()
  })

  it('binds text and image independently to the named secondary profile, and logout closes both', async () => {
    const test = rig()
    await test.login()
    expect(await test.bind()).toMatchObject({ ok: true, model_id: 'text' })
    expect(await test.bind('image', 'other-secondary')).toMatchObject({ ok: true, model_id: 'image' })
    expect(test.gatewayFetch.mock.calls.map(([url]) => String(url))).toEqual([
      'http://localhost:3000/hermes/api/webapp/socket-ticket?socket=gateway&profile=secondary',
      'http://localhost:3000/hermes/api/webapp/socket-ticket?socket=gateway&profile=other-secondary'
    ])
    expect(
      test.request.mock.calls
        .filter(([method]) => method === 'session.bind_managed_model')
        .map(([, params]) => [params.profile, params.purpose ?? 'chat', params.owner])
    ).toEqual([
      ['secondary', 'chat', { platform_origin: 'https://api.agentera.com.cn', user_id: '17' }],
      ['other-secondary', 'image', { platform_origin: 'https://api.agentera.com.cn', user_id: '17' }]
    ])
    await test.bridge.platformAccount.logout()
    expect(test.close).toHaveBeenCalledTimes(2)
    expect(await test.bind()).toMatchObject({ ok: false, error: { code: 'not_authenticated' } })
  })

  it('uses the existing localized Aino confirmation dialog before sharing credentials with the host', async () => {
    const test = rig({ useDefaultConfirm: true })
    await test.login()
    const binding = test.bind()
    await vi.waitFor(() => expect($confirmRequest.get()).not.toBeNull())
    expect($confirmRequest.get()?.description).toContain(window.location.host)
    expect(test.gatewayFetch).not.toHaveBeenCalled()
    settleConfirm(false)
    expect(await binding).toEqual({ ok: false, error: { code: 'remote_not_authorized' } })
  })

  it('requires current account revision, remote consent and a profile-authorized gateway ticket', async () => {
    const test = rig()
    await test.login()
    const revision = (await test.bridge.platformAccount.status()).revision
    await expect(test.bridge.platformModels.owner(revision - 1)).rejects.toThrow('invalid_platform_input')
    test.confirmRemote.mockResolvedValueOnce(false)
    expect(await test.bind()).toEqual({ ok: false, error: { code: 'remote_not_authorized' } })
    expect(test.gatewayFetch).not.toHaveBeenCalled()
    test.gatewayFetch.mockResolvedValueOnce(new Response('Profile is not served', { status: 403 }))
    expect(await test.bind('image', 'unserved')).toMatchObject({ ok: false })
    expect(test.openGateway).not.toHaveBeenCalled()
    expect(test.apiCalls.some(call => call.url.endsWith('/desktop/credentials'))).toBe(false)
  })

  it('rejects an account generation change during lease acquisition without sending its key', async () => {
    let release!: () => void
    const test = rig({
      delayLease: new Promise<void>(resolve => {
        release = resolve
      })
    })
    await test.login()
    const result = test.bind()
    await vi.waitFor(() => expect(test.apiCalls.some(call => call.url.endsWith('/desktop/credentials'))).toBe(true))
    await test.bridge.platformAccount.logout()
    release()
    expect(await result).toMatchObject({ ok: false })
    expect(test.request.mock.calls.some(([method]) => method === 'session.bind_managed_model')).toBe(false)
  })

  it('does not retry a failed lease or bind a model when its credential is unavailable', async () => {
    const test = rig({ leaseFails: true })
    await test.login()
    expect(await test.bind()).toEqual({ ok: false, error: { code: 'quota_exhausted' } })
    expect(test.apiCalls.filter(call => call.url.endsWith('/desktop/credentials'))).toHaveLength(1)
    expect(test.request.mock.calls.some(([method]) => method === 'session.bind_managed_model')).toBe(false)
  })

  it('moves the gateway ticket into the canonical subprotocol before the socket dial', async () => {
    const calls: unknown[][] = []
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1
        constructor(...args: unknown[]) {
          calls.push(args)
          throw new Error('test transport stopped')
        }
      }
    )
    await expect(
      openBrowserPlatformGateway(
        'wss://host.example/api/ws?native_dial=browser&ticket=private-ticket&profile=secondary'
      )
    ).rejects.toThrow()
    expect(calls).toEqual([
      [
        'wss://host.example/api/ws?native_dial=browser&profile=secondary',
        ['hermes-gateway-v1', 'hermes-gateway-ticket.private-ticket']
      ]
    ])
  })
})
