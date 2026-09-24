import type { ErrorSurface } from '@/lib/error-surface'

import type { PlatformModel } from '../../shared/platform-contract'

import { platformModelCatalog, PlatformSelectionError } from './platform-models'

export type PlatformRecoveryAction = 'account' | 'new-chat' | 'picker' | 'rebind'

/** One deterministic recovery policy shared by pre-submit and retained turn errors. */
export function platformRecoveryActionForCode(code: string): PlatformRecoveryAction | null {
  if (['insufficient_balance', 'quota_exhausted', 'managed_balance_unavailable'].includes(code)) {
    return 'account'
  }

  if (
    [
      'not_authenticated',
      'managed_auth_unavailable',
      'managed_credential_expired',
      'managed_credential_revoked'
    ].includes(code)
  ) {
    return 'account'
  }

  if (['platform_account_changed', 'stale_account_revision'].includes(code)) {
    return 'new-chat'
  }

  if (code === 'gateway_binding_failed') {
    return 'rebind'
  }

  return code === 'model_unavailable' || code === 'unsupported_gateway' ? 'picker' : null
}

export function platformRecoveryAction(error: unknown): PlatformRecoveryAction | null {
  return error instanceof PlatformSelectionError ? platformRecoveryActionForCode(error.code) : null
}

interface PlatformCatalogReader {
  account: { get(): ReturnType<typeof platformModelCatalog>['account'] extends { get(): infer T } ? T : never }
  state: { get(): ReturnType<typeof platformModelCatalog>['state'] extends { get(): infer T } ? T : never }
  owner?: { state: { get(): { owner: { user_id: string; platform_origin: string } | null } } }
}

/** Catalog metadata is behavioral only after model id and stored owner agree. */
export function verifiedPlatformModelFrom(
  catalog: PlatformCatalogReader,
  modelId: string,
  ownerUserId: string,
  platformOrigin?: string
): PlatformModel | null {
  const account = catalog.account.get()
  const state = catalog.state.get()
  const owner = catalog.owner?.state.get().owner

  if (
    !modelId ||
    !ownerUserId ||
    account?.phase !== 'signed_in' ||
    account.account?.id !== ownerUserId ||
    (platformOrigin !== undefined &&
      (!owner || owner.user_id !== ownerUserId || owner.platform_origin !== platformOrigin)) ||
    state.phase !== 'ready'
  ) {
    return null
  }

  return state.models.find(model => model.id === modelId && model.state === 'available') ?? null
}

export function verifiedPlatformModel(
  modelId: string,
  ownerUserId: string,
  platformOrigin?: string
): PlatformModel | null {
  return verifiedPlatformModelFrom(platformModelCatalog(), modelId, ownerUserId, platformOrigin)
}

/** Stable managed failures must never offer an unchanged-turn replay. */
export function platformErrorSurface(error: unknown): ErrorSurface | null {
  if (!(error instanceof PlatformSelectionError)) {
    return null
  }

  const layer =
    error.code === 'insufficient_balance' ||
    error.code === 'quota_exhausted' ||
    error.code === 'managed_balance_unavailable'
      ? 'billing'
      : error.code === 'managed_auth_unavailable' ||
          error.code === 'managed_credential_expired' ||
          error.code === 'managed_credential_revoked' ||
          error.code === 'not_authenticated'
        ? 'auth'
        : 'gateway'

  return { code: error.code, layer, retryable: false }
}
