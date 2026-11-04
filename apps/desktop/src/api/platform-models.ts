import { requestGatewayForAgent } from '@/store/gateway'
import { platformModelCatalog } from '@/store/platform-models'
import { isSessionGoneForBackgroundPolling } from '@/store/session-gone-latch'

import { hasPlatformModelIdentity } from '../../shared/platform-contract'
import type {
  BindPlatformModelInput,
  BindPlatformModelResult,
  PlatformAccountSnapshot
} from '../../shared/platform-contract'

const SAFE_PLATFORM_BINDING_CODES = new Set([
  'DESKTOP_DEVICE_KEY_REVOKED',
  'DESKTOP_DEVICE_KEY_VERSION_CONFLICT',
  'binding_cancelled',
  'insufficient_balance',
  'managed_auth_unavailable',
  'managed_balance_unavailable',
  'managed_credential_expired',
  'managed_credential_revoked',
  'managed_credential_rejected',
  'model_unavailable',
  'not_authenticated',
  'platform_account_changed',
  'quota_exhausted',
  'stale_account_revision',
  'unsupported_gateway'
])

export function reportPlatformCredentialRejection(code: string | undefined, ownerUserId?: string, credentialVersion?: number) {
  if (
    !code ||
    !['managed_credential_revoked', 'managed_credential_rejected', 'DESKTOP_DEVICE_KEY_REVOKED'].includes(code)
  ) {
    return
  }

  const account = platformModelCatalog().account.get()

  if (account?.account && account.model_identity_ready && ownerUserId === account.account.id && credentialVersion !== undefined && credentialVersion === account.model_identity_version) {
    void window.hermesDesktop?.platformModels?.credentialRejected?.(account.revision, credentialVersion).catch(() => undefined)
  }
}

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

async function tryNativeBinding(bridge: NonNullable<Window['hermesDesktop']>['platformModels'], input: BindPlatformModelInput): Promise<BindPlatformModelResult | null> {
  if (!bridge.nativeDeviceKeys) { return null }

  try {
    const result = await bridge.bind({ ...input, session_ticket: '' })

    return result.ok || result.error.code !== 'binding_ticket_required' ? result : null
  } catch (error) { return bindingFailure(error) }
}

/** Only the chat's owning socket can delegate a live session to Electron main. */
export async function bindPlatformModel(
  input: BindPlatformModelInput,
  account: PlatformAccountSnapshot,
  request?: <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
): Promise<BindPlatformModelResult> {
  if (!hasPlatformModelIdentity(account) || account.revision !== input.expected_account_revision) {
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

  const reused = await tryNativeBinding(desktop.platformModels, input)

  if (reused) { return reused }

  const requestOwner =
    request ??
    (<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) =>
      requestGatewayForAgent<T>(input.connection_id || null, input.profile, method, params, timeoutMs))

  let ticket: { managed_model_binding?: number; managed_image_binding?: number; session_ticket?: string }

  try {
    ticket = await requestOwner<typeof ticket>(
      'session.managed_model_ticket',
      {
        session_id: input.session_id,
        model_id: input.model_id,
        ...(input.purpose === 'image' ? { purpose: 'image' } : {}),
        owner
      },
      10_000
    )
  } catch (error) {
    if (isSessionGoneForBackgroundPolling(error)) {
      throw error
    }

    return bindingFailure(error)
  }

  const supported = input.purpose === 'image' ? ticket.managed_image_binding === 1 : ticket.managed_model_binding === 1

  if (!supported || !ticket.session_ticket) {
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
