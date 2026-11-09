import { JsonRpcGatewayError } from '@hermes/shared'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { requestGatewayForAgent } from '@/store/gateway'

import type { PlatformAccountSnapshot, PlatformModelsBridge } from '../../shared/platform-contract'

import { bindPlatformModel, reportPlatformCredentialRejection } from './platform-models'

vi.mock('@/store/gateway', () => ({ requestGatewayForAgent: vi.fn() }))

it('uses the native trusted binding before requesting another renderer session ticket', async () => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'encrypted',
    error: null
  }
  const bind = vi.fn(async () => ({
    ok: true as const,
    ready: true as const,
    model_id: 'fixture',
    billing_source: 'aino' as const,
    expires_at: null
  }))
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformModels: {
        nativeDeviceKeys: true,
        owner: async () => ({ platform_origin: 'https://fixture.test', user_id: '17' }),
        bind
      }
    }
  })
  const request = vi.fn()
  expect(
    (
      await bindPlatformModel(
        {
          connection_id: 'local',
          profile: 'default',
          session_id: 'session',
          model_id: 'fixture',
          expected_account_revision: 7
        },
        account,
        request
      )
    ).ok
  ).toBe(true)
  expect(bind).toHaveBeenCalledWith(expect.objectContaining({ session_ticket: '' }))
  expect(request).not.toHaveBeenCalled()
})

it('ignores an old failed turn after reauthorization and a new binding replaced the device key', async () => {
  const snapshot: PlatformAccountSnapshot = {
    revision: 5,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'encrypted',
    error: null,
    model_identity_ready: true,
    model_identity_version: 2
  }
  const credentialRejected = vi.fn(async () => undefined)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: { status: async () => snapshot, capabilities: async () => ({}), onChanged: () => () => {} },
      platformModels: {
        list: async () => [],
        owner: async () => ({ user_id: '17', platform_origin: 'https://fixture.test' }),
        credentialRejected
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  reportPlatformCredentialRejection('managed_credential_revoked', '17', 1)
  reportPlatformCredentialRejection('managed_credential_rejected', '17')
  expect(credentialRejected).not.toHaveBeenCalled()
  reportPlatformCredentialRejection('managed_credential_rejected', '17', 2)
  expect(credentialRejected).toHaveBeenCalledWith(5, 2)
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('requests the ticket on the session owner route before calling the native binding bridge', async () => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const input = {
    connection_id: 'local',
    profile: 'work',
    session_id: 'runtime-session',
    model_id: 'fixture',
    expected_account_revision: 7
  }

  const owner = { platform_origin: 'http://127.0.0.1:1234', user_id: '17' }

  const bind = vi.fn().mockResolvedValue({
    ok: true,
    ready: true,
    model_id: 'fixture',
    billing_source: 'aino',
    expires_at: 'fixture-expiry'
  })

  const bridge: PlatformModelsBridge = { owner: async () => owner, bind, clear: async () => {}, list: async () => [] }
  const logLine = vi.fn()
  Object.defineProperty(window, 'hermesDesktop', {
    value: { platformModels: bridge, logLine },
    writable: true,
    configurable: true
  })
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ managed_model_binding: 1, session_ticket: 'single-use-ticket' })
  expect((await bindPlatformModel(input, account)).ok).toBe(true)
  expect(requestGatewayForAgent).toHaveBeenCalledWith(
    'local',
    'work',
    'session.managed_model_ticket',
    { session_id: 'runtime-session', model_id: 'fixture', owner },
    10_000
  )
  expect(bind).toHaveBeenCalledWith({ ...input, session_ticket: 'single-use-ticket' })
  bind.mockClear()
  expect((await bindPlatformModel({ ...input, expected_account_revision: 6 }, account)).ok).toBe(false)
  vi.mocked(requestGatewayForAgent).mockRejectedValue(new Error('raw remote error'))
  const failed = await bindPlatformModel(input, account)

  expect(failed).toEqual({ ok: false, error: { code: 'gateway_binding_failed' } })
  expect(JSON.stringify(failed)).not.toContain('raw remote error')
  expect(logLine).toHaveBeenCalledWith('[platform-model-binding] stage=gateway_ticket code=unknown')
  expect(JSON.stringify(logLine.mock.calls)).not.toContain('raw remote error')
  expect(bind).not.toHaveBeenCalled()

  logLine.mockClear()
  vi.mocked(requestGatewayForAgent).mockRejectedValue(
    new JsonRpcGatewayError('private gateway message', {
      code: 4403,
      data: { reason: 'managed_binding_forbidden', session_id: 'private-session' }
    })
  )
  const denied = await bindPlatformModel(input, account)
  expect(denied).toEqual({ ok: false, error: { code: 'gateway_binding_failed' } })
  expect(logLine).toHaveBeenCalledWith('[platform-model-binding] stage=gateway_ticket code=managed_binding_forbidden')
  expect(JSON.stringify(logLine.mock.calls)).not.toContain('private gateway message')
  expect(JSON.stringify(logLine.mock.calls)).not.toContain('private-session')
})

it('preserves a structured missing-session ticket error for stale-runtime recovery', async () => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const stale = new JsonRpcGatewayError('session not found', {
    code: 4001,
    data: { session_id: 'old-runtime' }
  })

  const bind = vi.fn()

  const bridge: PlatformModelsBridge = {
    owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: '17' }),
    bind,
    clear: async () => {},
    list: async () => []
  }

  Object.defineProperty(window, 'hermesDesktop', {
    value: { platformModels: bridge },
    writable: true,
    configurable: true
  })
  vi.mocked(requestGatewayForAgent).mockRejectedValue(stale)

  await expect(
    bindPlatformModel(
      {
        connection_id: 'local',
        profile: 'work',
        session_id: 'old-runtime',
        model_id: 'fixture',
        expected_account_revision: 7
      },
      account
    )
  ).rejects.toBe(stale)
  expect(bind).not.toHaveBeenCalled()
})

it.each(['owner', 'bind'] as const)('sanitizes a structured missing-session error from native %s', async stage => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const stale = new JsonRpcGatewayError(`native ${stage} session not found`, {
    code: 4001,
    data: { secret: 'must-not-escape' }
  })

  const bind = vi.fn(async () => {
    if (stage === 'bind') {
      throw stale
    }

    return {
      ok: true as const,
      ready: true as const,
      model_id: 'fixture',
      billing_source: 'aino' as const,
      expires_at: 'later'
    }
  })

  const bridge: PlatformModelsBridge = {
    owner: async () => {
      if (stage === 'owner') {
        throw stale
      }

      return { platform_origin: 'http://127.0.0.1:1234', user_id: '17' }
    },
    bind,
    clear: async () => {},
    list: async () => []
  }

  Object.defineProperty(window, 'hermesDesktop', {
    value: { platformModels: bridge },
    writable: true,
    configurable: true
  })
  vi.mocked(requestGatewayForAgent).mockResolvedValue({
    managed_model_binding: 1,
    session_ticket: 'single-use-ticket'
  })

  const failed = await bindPlatformModel(
    {
      connection_id: 'local',
      profile: 'work',
      session_id: 'runtime-session',
      model_id: 'fixture',
      expected_account_revision: 7
    },
    account
  )

  expect(failed).toEqual({ ok: false, error: { code: 'gateway_binding_failed' } })
  expect(JSON.stringify(failed)).not.toContain('must-not-escape')
})

it.each([
  ['ticket', 'insufficient_balance'],
  ['owner', 'managed_credential_expired'],
  ['bind', 'quota_exhausted']
] as const)('preserves the allowlisted %s failure code without exposing remote text', async (stage, code) => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const failure = { code, data: { code, message: 'remote secret must not escape' } }

  const bridge: PlatformModelsBridge = {
    owner: async () => {
      if (stage === 'owner') {
        throw failure
      }

      return { platform_origin: 'http://127.0.0.1:1234', user_id: '17' }
    },
    bind: async () => {
      if (stage === 'bind') {
        throw failure
      }

      return { ok: true, ready: true, model_id: 'fixture', billing_source: 'aino', expires_at: 'later' }
    },
    clear: async () => {},
    list: async () => []
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { platformModels: bridge } })
  vi.mocked(requestGatewayForAgent).mockImplementation(async () => {
    if (stage === 'ticket') {
      throw failure
    }

    return { managed_model_binding: 1, session_ticket: 'ticket' }
  })

  const result = await bindPlatformModel(
    {
      connection_id: 'local',
      profile: 'work',
      session_id: 'runtime-session',
      model_id: 'fixture',
      expected_account_revision: 7
    },
    account
  )

  expect(result).toEqual({ ok: false, error: { code } })
  expect(JSON.stringify(result)).not.toContain('remote secret')
})

it.each([
  ['quota_exhausted', 'quota_exhausted'],
  ['RECENT_AUTH_REQUIRED', 'RECENT_AUTH_REQUIRED'],
  ['untrusted_remote_code', 'gateway_binding_failed']
] as const)('sanitizes resolved native bind failures to the stable allowlist', async (remoteCode, expectedCode) => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const bridge: PlatformModelsBridge = {
    owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: '17' }),
    bind: async () => ({ ok: false, error: { code: remoteCode, message: 'remote secret must not escape' } }),
    clear: async () => {},
    list: async () => []
  }

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { platformModels: bridge } })
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ managed_model_binding: 1, session_ticket: 'ticket' })

  const result = await bindPlatformModel(
    {
      connection_id: 'local',
      profile: 'work',
      session_id: 'runtime-session',
      model_id: 'fixture',
      expected_account_revision: 7
    },
    account
  )

  expect(result).toEqual({ ok: false, error: { code: expectedCode } })
  expect(JSON.stringify(result)).not.toContain('remote secret')
})

it('requests an image-purpose ticket and requires the separate image binding capability', async () => {
  const account: PlatformAccountSnapshot = {
    revision: 7,
    phase: 'signed_in',
    account: { id: '17', display_name: 'Fixture', email: '', phone_masked: '' },
    mode: 'development',
    remember_state: 'session_only',
    error: null
  }

  const owner = { platform_origin: 'http://127.0.0.1:1234', user_id: '17' }
  const bind = vi.fn().mockResolvedValue({ ok: true, ready: true })
  const bridge: PlatformModelsBridge = { owner: async () => owner, bind, clear: async () => {}, list: async () => [] }
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { platformModels: bridge } })
  const request = vi.fn().mockResolvedValue({ managed_image_binding: 1, session_ticket: 'image-ticket' })

  const input = {
    connection_id: 'remote',
    profile: 'writer',
    session_id: 'byok-chat',
    model_id: 'image-catalog',
    purpose: 'image' as const,
    expected_account_revision: 7
  }

  expect((await bindPlatformModel(input, account, request)).ok).toBe(true)
  expect(request).toHaveBeenCalledWith(
    'session.managed_model_ticket',
    {
      session_id: 'byok-chat',
      model_id: 'image-catalog',
      purpose: 'image',
      owner
    },
    10_000
  )
  expect(bind).toHaveBeenCalledWith({ ...input, session_ticket: 'image-ticket' })
  bind.mockClear()
  request.mockResolvedValue({ managed_model_binding: 1, session_ticket: 'chat-ticket' })
  expect(await bindPlatformModel(input, account, request)).toEqual({
    ok: false,
    error: { code: 'unsupported_gateway' }
  })
  expect(bind).not.toHaveBeenCalled()
})
