import type { ModelOptionProvider } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { usePlatformModels } from '@/components/platform-model-list'
import { availablePlatformDefault } from '@/lib/model-default'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { $activeConnectionId } from '@/store/connections'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { platformModelCatalog, readPlatformDefault } from '@/store/platform-models'

import { hasPlatformModelIdentity } from '../../../shared/platform-contract'

import type { DefaultMainModelSource } from './default-main-model'
import { appliedMainModelSource } from './default-main-model-source'

interface ProviderDraft {
  provider: string
  model: string
}

/** Presentation drafts only. Runtime configuration and catalog preferences remain authoritative. */
export function useDefaultMainModel(
  main: { provider: string; model: string } | null,
  scopeProfile: string | undefined,
  providers: readonly ModelOptionProvider[] = []
) {
  useStore($activeConnectionId)
  const platform = usePlatformModels()
  const { owner } = useStore(platformModelCatalog().owner.state)
  const scope = platformDefaultScope(scopeProfile)
  const capabilities = useStore($gatewayManagedCapabilities)
  const capability = managedModelRouteCapabilityFrom(capabilities, scope.route)
  const [sourceDraft, setSourceDraft] = useState<DefaultMainModelSource | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<'provider' | 'custom', ProviderDraft>>>({})

  const preferredId = readPlatformDefault(
    platform.account?.account?.id || '',
    scope,
    platform.account?.mode,
    owner?.platform_origin
  )

  const platformOwnerReady =
    hasPlatformModelIdentity(platform.account) &&
    capability === 'supported' &&
    owner?.user_id === platform.account.account?.id

  const platformReady = platformOwnerReady && platform.phase === 'ready'
  // The catalog retains only this account revision's models during a refresh.
  // Keep their applied label visible; selection still needs a ready catalog.
  const platformDisplayReady = platformOwnerReady && (platform.phase === 'ready' || platform.phase === 'loading')

  const appliedPlatformModel = platformDisplayReady ? availablePlatformDefault(platform.models, preferredId) : undefined
  const appliedPlatformId = appliedPlatformModel?.id || ''
  const appliedSource = appliedMainModelSource(main, providers)

  const source = sourceDraft ?? appliedSource
  const providerSource = source === 'custom' ? 'custom' : 'provider'

  const providerDraft = providerDrafts[providerSource] ??
    (appliedSource === providerSource ? main : null) ?? { provider: '', model: '' }

  const selectedPlatformId = modelDraft ?? appliedPlatformId
  const selectedPlatformModel = platform.models.find(model => model.id === selectedPlatformId)

  useEffect(() => {
    setSourceDraft(null)
    setModelDraft(null)
    setProviderDrafts({})
  }, [scope.key, platform.account?.account?.id, platform.account?.mode])

  return {
    platform,
    scope,
    capability,
    source,
    appliedSource,
    selectedPlatformId,
    selectedPlatformModel,
    appliedPlatformModel,
    appliedPlatformId,
    selectedProvider: providerDraft.provider,
    selectedModel: providerDraft.model,
    chooseProvider: (provider: string) => {
      setProviderDrafts(current => ({
        ...current,
        [providerSource]: { provider, model: provider === providerDraft.provider ? providerDraft.model : '' }
      }))
    },
    setProviderModel: (model: string) => {
      setProviderDrafts(current => ({ ...current, [providerSource]: { ...providerDraft, model } }))
    },
    setSource: setSourceDraft,
    setPlatformModel: setModelDraft,
    reset: () => {
      setSourceDraft(null)
      setModelDraft(null)
      setProviderDrafts({})
    },
    platformCanApply: platformReady && selectedPlatformModel?.state === 'available'
  }
}
