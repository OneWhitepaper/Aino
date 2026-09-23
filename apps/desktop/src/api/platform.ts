import { JsonRpcGatewayError } from '@hermes/shared'

import { queryClient } from '@/lib/query-client'
import type { RuntimeReadinessRequester } from '@/lib/runtime-readiness'
import { type AccountAdapter, createAccountActions } from '@/store/account'

import type { PlatformAccountBridge, PlatformBillingScope } from '../../shared/platform-contract'

const billingQueryRoot = ['billing', 'platform'] as const

export function platformBillingQueryKey(scope: PlatformBillingScope) {
  return [...billingQueryRoot, scope.origin, scope.user_id, scope.generation] as const
}

export function samePlatformBillingScope(left: PlatformBillingScope, right: PlatformBillingScope) {
  return left.origin === right.origin && left.user_id === right.user_id && left.generation === right.generation
}

export function createPlatformAccountActions(bridge: PlatformAccountBridge) {
  const adapter: AccountAdapter = {
    kind: 'platform',
    fixedCodeHint: false,
    status: () => bridge.status(),
    capabilities: () => bridge.capabilities(),
    retry: () => bridge.retry(),
    requestPhoneCode: phone => bridge.requestPhoneCode({ phone }),
    verifyPhoneCode: input => bridge.verifyPhoneCode(input),
    loginExisting: input => bridge.loginExisting(input),
    completeSecondFactor: code => bridge.completeSecondFactor({ totp_code: code }),
    updateProfile: displayName => bridge.updateProfile({ display_name: displayName }),
    logout: () => bridge.logout(),
    onChanged: listener => bridge.onChanged(listener)
  }

  const actions = createAccountActions(adapter)
  // Account actions outlive settings, so sign-out also retires caches while the page is closed.
  actions.snapshot.listen((next, previous) => {
    if (
      !next?.account ||
      !['signed_in', 'offline'].includes(next.phase) ||
      next.account.id !== previous?.account?.id ||
      next.mode !== previous?.mode
    ) {
      queryClient.removeQueries({ queryKey: billingQueryRoot })
    }
  })

  return actions
}

let cached: { bridge: PlatformAccountBridge; actions: ReturnType<typeof createPlatformAccountActions> } | null = null

export function platformAccountActions(bridge: PlatformAccountBridge) {
  if (!cached || cached.bridge !== bridge) {
    cached = { bridge, actions: createPlatformAccountActions(bridge) }
  }

  return cached.actions
}

interface LegacyAccountStatus {
  authenticated: boolean
  account: null | { id: string; identifier: string; display_name: string }
}

const legacyCapabilities = {
  desktop_api_version: 1,
  registration_enabled: true,
  phone_login_enabled: true,
  phone_registration_enabled: true,
  phone_binding_enabled: false,
  phone_regions: [],
  phone_code_length: 4,
  invitation_code_enabled: false,
  promo_code_enabled: false,
  login_agreement_enabled: true,
  login_agreement_mode: 'checkbox',
  login_agreement_revision: 'legacy-development',
  login_agreement_documents: [
    { id: 'terms', title: 'User Agreement', content_md: 'Local development account flow only.' },
    { id: 'privacy', title: 'Privacy Policy', content_md: 'No SMS or email is sent by this adapter.' }
  ],
  captcha: { provider: 'disabled' as const, site_key: '', scene_id: '', prefix: '', region: '' }
}

export function createLegacyDevelopmentAccountActions(requestGateway: RuntimeReadinessRequester) {
  let revision = 0

  const request = async <T>(method: string, params?: Record<string, unknown>) => {
    try {
      return await (params === undefined ? requestGateway<T>(method) : requestGateway<T>(method, params))
    } catch (error) {
      const data = error instanceof JsonRpcGatewayError ? error.data : null
      const source = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}

      const next = Object.assign(new Error(String(source.reason || 'platform_error')), {
        code: typeof source.reason === 'string' ? source.reason : 'platform_error',
        ...(typeof source.retry_after === 'number' ? { retry_after: source.retry_after } : {})
      })

      throw next
    }
  }

  const snapshot = (status: LegacyAccountStatus) => {
    const identifier = status.account?.identifier ?? ''

    return {
      revision: ++revision,
      phase: status.authenticated && status.account ? ('signed_in' as const) : ('signed_out' as const),
      account:
        status.authenticated && status.account
          ? {
              id: status.account.id,
              display_name: status.account.display_name,
              phone_masked: identifier.includes('@') ? '' : identifier,
              email: identifier.includes('@') ? identifier : ''
            }
          : null,
      mode: 'development' as const,
      remember_state: 'session_only' as const,
      error: null
    }
  }

  const status = async () => snapshot(await request<LegacyAccountStatus>('account.status'))

  const adapter: AccountAdapter = {
    kind: 'legacy-development',
    fixedCodeHint: true,
    status,
    capabilities: async () => legacyCapabilities,
    retry: status,
    async requestPhoneCode(identifier) {
      const result = await request<{ delivery: string; expires_in: number; retry_after: number }>(
        'account.request_code',
        { identifier }
      )

      return { ...result, challenge_id: `legacy:${identifier}` }
    },
    async verifyPhoneCode(input) {
      const result = await request<LegacyAccountStatus>('account.verify_code', {
        identifier: input.phone,
        code: input.code
      })

      return { status: 'signed_in', snapshot: snapshot(result) }
    },
    async loginExisting() {
      throw Object.assign(new Error('development_disabled'), { code: 'development_disabled' })
    },
    async completeSecondFactor() {
      throw Object.assign(new Error('second_factor_not_pending'), { code: 'second_factor_not_pending' })
    },
    async updateProfile(displayName) {
      return snapshot(
        await request<LegacyAccountStatus>('account.update_profile', {
          display_name: displayName
        })
      )
    },
    async logout() {
      return snapshot(await request<LegacyAccountStatus>('account.logout'))
    },
    onChanged: () => () => {}
  }

  return createAccountActions(adapter)
}
