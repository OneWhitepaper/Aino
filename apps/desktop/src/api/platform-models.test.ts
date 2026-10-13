import { JsonRpcGatewayError } from '@hermes/shared'
import { afterEach, expect, it, vi } from 'vitest'

import { requestGatewayForAgent } from '@/store/gateway'

import type { PlatformAccountSnapshot, PlatformModelsBridge } from '../../shared/platform-contract'

import { bindPlatformModel } from './platform-models'

vi.mock('@/store/gateway', () => ({ requestGatewayForAgent: vi.fn() }))
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
  Object.defineProperty(window, 'hermesDesktop', {
    value: { platformModels: bridge },
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
  expect(bind).not.toHaveBeenCalled()
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
