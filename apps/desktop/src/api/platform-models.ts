import { requestGatewayForAgent } from '@/store/gateway'
import { isSessionGoneForBackgroundPolling } from '@/store/session-gone-latch'

import type {
  BindPlatformModelInput,
  BindPlatformModelResult,
  PlatformAccountSnapshot
} from '../../shared/platform-contract'

const SAFE_PLATFORM_BINDING_CODES = new Set([
  'binding_cancelled',
  'insufficient_balance',
  'managed_auth_unavailable',
  'managed_balance_unavailable',
  'managed_credential_expired',
  'managed_credential_revoked',
  'model_unavailable',
  'not_authenticated',
  'platform_account_changed',
  'quota_exhausted',
  'stale_account_revision',
  'unsupported_gateway'
])

function safeBindingCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const record = error as { code?: unknown; data?: unknown }
  const data =
    record.data && typeof record.data === 'object' ? (record.data as { code?: unknown; error?: unknown }) : null
  const nested = data?.error && typeof data.error === 'object' ? (data.error as { code?: unknown }) : null
  const candidates = [record.code, data?.code, nested?.code]

  return (
    candidates.find((code): code is string => typeof code === 'string' && SAFE_PLATFORM_BINDING_CODES.has(code)) ?? null
  )
}

function bindingFailure(error: unknown): BindPlatformModelResult {
  return { ok: false, error: { code: safeBindingCode(error) ?? 'gateway_binding_failed' } }
}

/** Only the chat's owning socket can delegate a live session to Electron main. */
export async function bindPlatformModel(
  input: BindPlatformModelInput,
  account: PlatformAccountSnapshot,
  request?: <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
): Promise<BindPlatformModelResult> {
  if (account.phase !== 'signed_in' || !account.account || account.revision !== input.expected_account_revision) {
    return { ok: false, error: { code: 'stale_account_revision' } }
  }

  const desktop = window.hermesDesktop

  if (!desktop?.platformModels) {
    return { ok: false, error: { code: 'unsupported_desktop' } }
  }

  let owner: Awaited<ReturnType<typeof desktop.platformModels.owner>>

  try {
    owner = await desktop.platformModels.owner(input.expected_account_revision)
  } catch (error) {
    return bindingFailure(error)
  }

  if (owner.user_id !== account.account.id || !owner.platform_origin) {
    return { ok: false, error: { code: 'platform_account_changed' } }
  }

  const requestOwner =
    request ??
    (<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) =>
      requestGatewayForAgent<T>(input.connection_id || null, input.profile, method, params, timeoutMs))

  let ticket: { managed_model_binding?: number; session_ticket?: string }

  try {
    ticket = await requestOwner<{ managed_model_binding?: number; session_ticket?: string }>(
      'session.managed_model_ticket',
      { session_id: input.session_id, model_id: input.model_id, owner },
      10_000
    )
  } catch (error) {
    if (isSessionGoneForBackgroundPolling(error)) {
      throw error
    }

    return bindingFailure(error)
  }

  if (ticket.managed_model_binding !== 1 || !ticket.session_ticket) {
    return { ok: false, error: { code: 'unsupported_gateway' } }
  }

  try {
    const result = await desktop.platformModels.bind({ ...input, session_ticket: ticket.session_ticket })

    if (!result.ok) {
      return { ok: false, error: { code: safeBindingCode(result.error) ?? 'gateway_binding_failed' } }
    }

    return result
  } catch (error) {
    return bindingFailure(error)
  }
}
