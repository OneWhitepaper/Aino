import { getGlobalModelInfo, type ProfileScope } from '@/hermes'
import { platformModelSupportsPurpose } from '@/lib/platform-model-purpose'
import { type PlatformDefaultScope, platformDefaultScope } from '@/lib/platform-model-scope'
import {
  evaluateRuntimeReadiness,
  type RuntimeReadinessOptions,
  type RuntimeReadinessRequester,
  type RuntimeReadinessResult
} from '@/lib/runtime-readiness'
import { managedModelRouteCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog, PlatformSelectionError, readPlatformDefault } from '@/store/platform-models'

import { hasPlatformModelIdentity, type PlatformModel } from '../../shared/platform-contract'

/** The saved preference is usable only while the catalog authorizes that model. */
export function availablePlatformDefault(models: readonly PlatformModel[], preferredId: string | null) {
  const chatModels = models.filter(model => platformModelSupportsPurpose(model, 'chat'))

  return (
    chatModels.find(model => model.state === 'available' && model.id === preferredId) ||
    chatModels.find(model => model.is_default && model.state === 'available')
  )
}

async function loadDefaultModelInputs(scope: ProfileScope, catalog: ReturnType<typeof platformModelCatalog>) {
  const result = await getGlobalModelInfo(scope)

  // A configured profile does not depend on Aino account/catalog reachability.
  if (!result.model && !result.provider) {
    await catalog.load()
  }

  return result
}

/** Resolve backend/default billing identity without publishing into the composer. */
export async function resolveModelDefault(scope: ProfileScope, managedRoute?: PlatformDefaultScope['route']) {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const capturedScope = platformDefaultScope(scope)
  const result = await loadDefaultModelInputs(scope, catalog)
  const currentAccount = catalog.account.get()

  if (
    account?.account?.id !== currentAccount?.account?.id ||
    account?.revision !== currentAccount?.revision ||
    account?.phase !== currentAccount?.phase ||
    account?.mode !== currentAccount?.mode ||
    capturedScope.key !== platformDefaultScope(scope).key
  ) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  if (result.model || result.provider) {
    return { model: result.model || '', provider: result.provider || '', platform: null }
  }

  const owner = catalog.owner.state.get().owner

  if (!owner || owner.user_id !== currentAccount?.account?.id) {
    throw new PlatformSelectionError('platform_account_changed')
  }

  const preferredId = readPlatformDefault(
    currentAccount.account.id,
    capturedScope,
    currentAccount.mode,
    owner.platform_origin
  )

  const state = catalog.state.get()
  const managedSupported = managedModelRouteCapability(managedRoute ?? capturedScope.route) === 'supported'

  const platformDefault =
    managedSupported && state.phase === 'ready' ? availablePlatformDefault(state.models, preferredId) : undefined

  if (hasPlatformModelIdentity(account) && managedSupported && !platformDefault) {
    throw new PlatformSelectionError('model_unavailable')
  }

  const model = platformDefault?.id || ''
  const provider = model ? 'aino' : ''

  const platform =
    provider === 'aino' && platformDefault?.id === model
      ? {
          modelId: model,
          ownerUserId: account?.account?.id || '',
          platformOrigin: owner.platform_origin
        }
      : null

  return { model, provider, platform }
}

/** Aino inference can be available without a profile API key or a chosen default. */
export async function evaluateModelDefaultReadiness(
  requestGateway: RuntimeReadinessRequester,
  scope: ProfileScope,
  options: RuntimeReadinessOptions = {}
): Promise<RuntimeReadinessResult> {
  const catalog = platformModelCatalog()

  if (hasPlatformModelIdentity(catalog.account.get())) {
    try {
      const resolved = await resolveModelDefault(scope)

      if (resolved.platform) {
        return {
          checksDisagree: false,
          freeTier: false,
          model: resolved.model,
          ready: true,
          reason: null,
          source: 'platform_model'
        }
      }

      // A configured default is an explicit provider check, so retain its actual failure
      // rather than replacing it with the first-launch credential instructions.
      return evaluateRuntimeReadiness(requestGateway, {
        ...options,
        requestedProvider: options.requestedProvider ?? (resolved.provider || undefined)
      })
    } catch (error) {
      if (error instanceof PlatformSelectionError) {
        const state = catalog.state.get()

        // Default resolution rejects an absent/unavailable default even when another
        // authorized model is selectable. Health must not turn that choice into an outage.
        const selectionAvailable =
          error.code === 'model_unavailable' &&
          state.phase === 'ready' &&
          state.models.some(model => model.state === 'available' && platformModelSupportsPurpose(model, 'chat'))

        return {
          checksDisagree: false,
          freeTier: false,
          ready: selectionAvailable,
          reason: selectionAvailable ? null : error.message,
          source: 'platform_model'
        }
      }
    }
  }

  return evaluateRuntimeReadiness(requestGateway, options)
}
