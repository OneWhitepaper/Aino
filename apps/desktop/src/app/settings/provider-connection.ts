import type { ModelOptionProvider } from '@hermes/shared'

import { capabilityScoped, type ProfileScope } from '@/api/client'
import { getGlobalModelOptions, getRecommendedDefaultModel, setEnvVar, validateProviderCredential } from '@/hermes'
import { findCatalogProvider } from '@/lib/model-options'

import { isCustomModelProvider } from './model-provider-source'

export interface ProviderConnectionResult {
  providers: ModelOptionProvider[]
  recommendedModel: string
}

/** The settings page and provider form share one credential/discovery action. */
export async function connectProviderApiKey(
  provider: ModelOptionProvider,
  apiKey: string,
  scope?: ProfileScope
): Promise<ProviderConnectionResult> {
  const requested = capabilityScoped(scope)
  // Untagged halves keep legacy profile routing; a synthetic local pin would
  // bypass the profile's remote override after the credential probe.
  const owner = { connectionId: requested.connectionId ?? null, profile: requested.profile ?? null }
  const key = apiKey.trim()

  if (key && provider.key_env) {
    const validation = await validateProviderCredential(provider.key_env, key, undefined, owner)

    if (!validation.ok && validation.reachable) {
      throw new Error(validation.message)
    }

    await setEnvVar(provider.key_env, key, owner, { providerSetup: true })
  }

  const options = await getGlobalModelOptions({ refresh: true, includeUnconfigured: true }, owner)
  const providers = options.providers || []

  const models =
    findCatalogProvider(
      providers.filter(row => !isCustomModelProvider(row)),
      provider.slug
    )?.models || []

  let recommendedModel = models[0] || ''

  try {
    const recommendation = await getRecommendedDefaultModel(provider.slug, owner)

    if (models.includes(recommendation.model)) {
      recommendedModel = recommendation.model
    }
  } catch {
    // The model list remains usable when the optional recommendation is unavailable.
  }

  return { providers, recommendedModel }
}
