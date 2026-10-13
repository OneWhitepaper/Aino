import { getGlobalModelInfo, type ProfileScope } from '@/hermes'
import { type PlatformDefaultScope, platformDefaultScope } from '@/lib/platform-model-scope'
import { managedModelRouteCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog, PlatformSelectionError, readPlatformDefault } from '@/store/platform-models'

/** Resolve backend/default billing identity without publishing into the composer. */
export async function resolveModelDefault(scope: ProfileScope, managedRoute?: PlatformDefaultScope['route']) {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const capturedScope = platformDefaultScope(scope)
  const [result] = await Promise.all([getGlobalModelInfo(scope), catalog.load()])
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
    managedSupported && state.phase === 'ready'
      ? state.models.find(model => model.state === 'available' && model.id === preferredId) ||
        state.models.find(model => model.is_default && model.state === 'available')
      : undefined

  if (account?.phase === 'signed_in' && managedSupported && !platformDefault) {
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
