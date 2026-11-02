import type { ModelOptionProvider } from '@hermes/shared'
import { type RefObject, useRef } from 'react'

import { findCatalogProvider } from '@/lib/model-options'

import { isCustomModelProvider } from './model-provider-source'
import { connectProviderApiKey } from './provider-connection'
import type { useSettingsModelCatalog } from './use-settings-model-catalog'

interface ProviderKeyActivation {
  apiKeyDraft: string
  owner: ReturnType<typeof useSettingsModelCatalog>['owner']
  ownerKey: string
  profileEpoch: RefObject<number>
  saveFailed: string
  selectedModel: string
  selectedProvider: string
  selectedProviderRow: ModelOptionProvider | undefined
  setActivating: (value: boolean) => void
  setApiKeyDraft: (value: string) => void
  setCatalogProviders: (value: ModelOptionProvider[]) => void
  setCaughtError: (error: unknown, fallback: string) => void
  setError: (value: string) => void
  setSelectedModel: (value: string) => void
  source: string
}

/** Keep credential discovery bound to its exact settings owner and edit intent. */
export function useProviderKeyActivation({
  apiKeyDraft,
  owner,
  ownerKey,
  profileEpoch,
  saveFailed,
  selectedModel,
  selectedProvider,
  selectedProviderRow,
  setActivating,
  setApiKeyDraft,
  setCatalogProviders,
  setCaughtError,
  setError,
  setSelectedModel,
  source
}: ProviderKeyActivation) {
  const keyOperation = useRef(0)
  const keyTarget = useRef({ selectedProvider, source: source, ownerKey: ownerKey, apiKeyDraft })
  keyTarget.current = { selectedProvider, source: source, ownerKey: ownerKey, apiKeyDraft }

  const activateApiKeyProvider = async () => {
    const row = selectedProviderRow
    const key = apiKeyDraft.trim()

    if (!row?.key_env || !key) {
      return false
    }

    const request = ++keyOperation.current
    const epoch = profileEpoch.current
    const target = keyTarget.current

    const isCurrent = () =>
      request === keyOperation.current &&
      epoch === profileEpoch.current &&
      keyTarget.current.selectedProvider === target.selectedProvider &&
      keyTarget.current.source === target.source &&
      keyTarget.current.ownerKey === target.ownerKey &&
      keyTarget.current.apiKeyDraft === target.apiKeyDraft

    setActivating(true)
    setError('')

    try {
      const result = await connectProviderApiKey(row, key, owner)

      if (!isCurrent()) {
        return false
      }

      setCatalogProviders(result.providers)

      const models =
        findCatalogProvider(
          result.providers.filter(row => !isCustomModelProvider(row)),
          row.slug
        )?.models ?? []

      setSelectedModel(models.includes(selectedModel) ? selectedModel : result.recommendedModel)
      setApiKeyDraft('')

      return true
    } catch (err) {
      if (isCurrent()) {
        setCaughtError(err, saveFailed)
      }

      return false
    } finally {
      if (request === keyOperation.current && epoch === profileEpoch.current) {
        setActivating(false)
      }
    }
  }

  return { activateApiKeyProvider, invalidateKeyActivation: () => void keyOperation.current++ }
}
