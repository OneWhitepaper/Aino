import { describe, expect, it, vi } from 'vitest'

import type { PlatformAccountSnapshot, PlatformPublicCapabilities } from '../../shared/platform-contract'
import { deferred } from '../test/deferred'

import { type AccountAdapter, createAccountActions } from './account'

const capabilities: PlatformPublicCapabilities = {
  desktop_api_version: 1,
  registration_enabled: true,
  phone_login_enabled: true,
  phone_registration_enabled: true,
  phone_binding_enabled: true,
  phone_regions: ['CN'],
  phone_code_length: 6,
  invitation_code_enabled: false,
  promo_code_enabled: false,
  login_agreement_enabled: false,
  login_agreement_mode: '',
  login_agreement_revision: '',
  login_agreement_documents: [],
  captcha: { provider: 'disabled', site_key: '', scene_id: '', prefix: '', region: '' }
}

const signedOut: PlatformAccountSnapshot = {
  revision: 1,
  phase: 'signed_out',
  account: null,
  mode: 'production',
  remember_state: 'session_only',
  error: null
}

function adapter(overrides: Partial<AccountAdapter> = {}): AccountAdapter {
  return {
    kind: 'platform',
    fixedCodeHint: false,
    status: vi.fn().mockResolvedValue(signedOut),
    capabilities: vi.fn().mockResolvedValue(capabilities),
    retry: vi.fn().mockResolvedValue(signedOut),
    requestPhoneCode: vi.fn(),
    verifyPhoneCode: vi.fn(),
    loginExisting: vi.fn(),
    completeSecondFactor: vi.fn(),
    updateProfile: vi.fn(),
    logout: vi.fn(),
    onChanged: vi.fn(() => () => {}),
    ...overrides
  }
}

describe('account actions', () => {
  it.each(['signed_in', 'offline'] as const)(
    'restores a known %s identity before login options finish loading',
    async phase => {
      const options = deferred<PlatformPublicCapabilities>()

      const snapshot: PlatformAccountSnapshot = {
        ...signedOut,
        phase,
        account: { id: 'restored', phone_masked: '', email: '', display_name: 'Restored' }
      }

      const actions = createAccountActions(
        adapter({
          status: async () => snapshot,
          capabilities: () => options.promise
        })
      )

      const pending = actions.refresh()

      await vi.waitFor(() =>
        expect(actions.state.get()).toMatchObject({
          authenticated: true,
          account: { id: 'restored' },
          loading: true,
          capabilities: null
        })
      )
      options.resolve(capabilities)
      await pending
      expect(actions.state.get().capabilities).toEqual(capabilities)
    }
  )

  it('loads status and capabilities together and exposes the authenticated account', async () => {
    const snapshot: PlatformAccountSnapshot = {
      ...signedOut,
      phase: 'signed_in',
      account: { id: 'abc', phone_masked: '+86 138****8000', email: '', display_name: 'Aino User' }
    }

    const source = adapter({ status: vi.fn().mockResolvedValue(snapshot) })
    const actions = createAccountActions(source)

    await actions.refresh()

    expect(source.status).toHaveBeenCalledOnce()
    expect(source.capabilities).toHaveBeenCalledOnce()
    expect(actions.state.get()).toMatchObject({
      authenticated: true,
      account: { id: 'abc' },
      phase: 'signed_in',
      error: null
    })
  })

  it.each([
    { phase: 'signed_out', failOptions: false },
    { phase: 'reauth_required', failOptions: true }
  ] as const)(
    'keeps a native $phase change authoritative while login options settle',
    async ({ phase, failOptions }) => {
      const options = deferred<PlatformPublicCapabilities>()

      const source = adapter({
        status: async () => ({
          ...signedOut,
          phase: 'signed_in',
          account: { id: 'restored', phone_masked: '', email: '', display_name: 'Restored' }
        }),
        capabilities: () => options.promise
      })

      const actions = createAccountActions(source)
      const pending = actions.refresh()

      await vi.waitFor(() => expect(actions.state.get().authenticated).toBe(true))
      vi.mocked(source.onChanged).mock.calls[0][0]({ ...signedOut, phase, revision: 2 })

      if (failOptions) {
        options.reject(Object.assign(new Error('offline'), { code: 'network_unavailable' }))
      } else {
        options.resolve(capabilities)
      }

      await pending
      expect(actions.state.get()).toMatchObject({ authenticated: false, phase, account: null, loading: false })
      expect(actions.snapshot.get()?.revision).toBe(2)
    }
  )

  it('surfaces safe structured errors and clears them after a successful refresh', async () => {
    const error = Object.assign(new Error('SMS_RATE_LIMITED'), { code: 'SMS_RATE_LIMITED', retry_after: 44 })
    const source = adapter({ loginExisting: vi.fn().mockRejectedValue(error) })
    const actions = createAccountActions(source)

    expect(await actions.loginExisting({ email: 'user@example.com', password: 'secret', remember: false })).toBeNull()
    expect(actions.state.get().error).toEqual({ code: 'SMS_RATE_LIMITED', retryAfter: 44 })
    await actions.refresh()
    expect(actions.state.get().error).toBeNull()
  })

  it('does not let a slow status refresh undo a newer successful login', async () => {
    let finishStatus!: (value: PlatformAccountSnapshot) => void

    const current: PlatformAccountSnapshot = {
      ...signedOut,
      revision: 2,
      phase: 'signed_in',
      account: { id: 'current', phone_masked: '', email: 'test@example.com', display_name: 'Test' }
    }

    const source = adapter({
      status: vi.fn(() => new Promise<PlatformAccountSnapshot>(resolve => (finishStatus = resolve))),
      loginExisting: vi.fn().mockResolvedValue({ status: 'signed_in', snapshot: current })
    })

    const actions = createAccountActions(source)
    const pending = actions.refresh()
    await actions.loginExisting({ email: 'test@example.com', password: 'secret', remember: false })
    finishStatus(signedOut)
    await pending

    expect(actions.state.get().account?.id).toBe('current')
  })

  it('ignores an older refresh even when a legacy adapter assigns its revision after the newer login', async () => {
    const status = deferred<PlatformAccountSnapshot>()

    const current: PlatformAccountSnapshot = {
      ...signedOut,
      revision: 2,
      phase: 'signed_in',
      account: { id: 'current', phone_masked: '', email: '', display_name: 'Current' }
    }

    const actions = createAccountActions(
      adapter({
        kind: 'legacy-development',
        status: () => status.promise,
        loginExisting: async () => ({ status: 'signed_in', snapshot: current })
      })
    )

    const pending = actions.refresh()
    await actions.loginExisting({ email: 'test@example.com', password: 'secret', remember: false })
    status.resolve({ ...signedOut, revision: 3 })
    await pending

    expect(actions.state.get().account?.id).toBe('current')
    expect(actions.state.get().authenticated).toBe(true)
  })

  it('publishes authoritative account changes received from another native window', () => {
    let changed: ((snapshot: PlatformAccountSnapshot) => void) | undefined
    const source = adapter({ onChanged: vi.fn(listener => ((changed = listener), () => {})) })
    const actions = createAccountActions(source)

    changed?.({
      ...signedOut,
      revision: 8,
      phase: 'signed_in',
      account: { id: 'shared', phone_masked: '+86 138****8000', email: '', display_name: 'Shared' }
    })

    expect(actions.state.get().account?.id).toBe('shared')
  })
})
