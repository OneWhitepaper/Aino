import { saveHermesConfig } from '@/hermes'
import { resolveModelDefault } from '@/lib/model-default'
import { platformDefaultScope, type PlatformDefaultScopeInput } from '@/lib/platform-model-scope'

import type { PlatformAccountSnapshot } from '../../shared/platform-contract'

import { managedModelRouteCapability } from './gateway-managed-capability'
import { samePlatformAccount } from './platform-model-owner'
import {
  platformModelCatalog,
  PlatformSelectionError,
  requirePlatformSelection,
  writePlatformDefault
} from './platform-models'
import {
  $activeSessionId,
  $currentPlatformOwner,
  $currentProvider,
  $selectedStoredSessionId,
  getComposerSelectionGeneration,
  markComposerSelectionDefault,
  setCurrentModel,
  setCurrentPlatformOwner,
  setCurrentProvider
} from './session'

/** Account changes invalidate only unsent platform intent, never session metadata or user content. */
export function reconcilePlatformDraftAccount(next: PlatformAccountSnapshot) {
  if ($activeSessionId.get() || $selectedStoredSessionId.get() || $currentProvider.get() !== 'aino') {
    return
  }

  if (
    next.account?.id === $currentPlatformOwner.get() &&
    next.phase !== 'signed_out' &&
    next.phase !== 'reauth_required'
  ) {
    return
  }

  markComposerSelectionDefault()
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentPlatformOwner('')
}

/** Activate clears only the higher-priority default route, retaining provider credentials. */
export async function savePlatformDraftDefault(
  account: PlatformAccountSnapshot,
  scope: PlatformDefaultScopeInput,
  modelId: string,
  options?: { activate?: boolean }
) {
  const catalog = platformModelCatalog()

  if (!samePlatformAccount(catalog.account.get(), account)) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  requirePlatformSelection(catalog.account.get(), catalog.state.get().models, modelId, account.account?.id || '')
  const captured = platformDefaultScope(scope)
  const owner = catalog.owner.state.get().owner
  const origin = owner?.platform_origin
  const selectionGeneration = getComposerSelectionGeneration()

  if (options?.activate) {
    if (!origin || owner.user_id !== account.account?.id) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    if (managedModelRouteCapability(captured.route) !== 'supported') {
      throw new PlatformSelectionError('unsupported_gateway')
    }

    const saved = await saveHermesConfig({ model: { default: '', name: '', provider: '' } }, captured.route)

    if (!saved.ok) {
      throw new PlatformSelectionError('binding_failed')
    }

    if (!samePlatformAccount(catalog.account.get(), account)) {
      throw new PlatformSelectionError('platform_account_changed')
    }
  }

  writePlatformDefault(account.account?.id || '', modelId, captured, account.mode, origin)

  const matchesDraft = () =>
    !$activeSessionId.get() &&
    !$selectedStoredSessionId.get() &&
    captured.key === platformDefaultScope().key &&
    samePlatformAccount(catalog.account.get(), account)

  if (!matchesDraft() || selectionGeneration !== getComposerSelectionGeneration()) {
    return
  }

  markComposerSelectionDefault()
  const generation = getComposerSelectionGeneration()
  const resolved = await resolveModelDefault(captured.route)

  if (!matchesDraft() || generation !== getComposerSelectionGeneration()) {
    return
  }

  setCurrentProvider(resolved.provider)
  setCurrentModel(resolved.model)
  setCurrentPlatformOwner(resolved.platform?.ownerUserId || '', resolved.platform?.platformOrigin || '')
}
