import type { ModelOptionProvider } from '@hermes/shared'

import { catalogProviderMatches } from '@/lib/model-options'
import type { EnvVarInfo } from '@/types/hermes'

const CUSTOM_SOURCES = new Set(['user-config', 'model-config', 'local-runtime'])

/** User-owned endpoint metadata takes precedence even when its slug resembles an official provider. */
export function isCustomModelProvider(row: ModelOptionProvider): boolean {
  const slug = row.slug.trim().toLowerCase()

  return (
    row.is_user_defined === true ||
    CUSTOM_SOURCES.has(row.source ?? '') ||
    slug === 'custom' ||
    slug === 'local' ||
    slug.startsWith('custom:') ||
    Boolean(row.aliases?.some(alias => alias.toLowerCase().startsWith('custom:')))
  )
}

interface CredentialHint {
  key: string
  label: string
  primary: boolean
  configured: boolean
  url: string | null
}

/** Merge the backend's provider/credential identities with its connected model inventory. No frontend provider presets. */
export function officialModelProviders(
  catalogProviders: readonly ModelOptionProvider[],
  envVars: Record<string, EnvVarInfo>
): ModelOptionProvider[] {
  const hints = new Map<string, CredentialHint>()

  for (const [key, variable] of Object.entries(envVars)) {
    if (!variable.is_password || variable.category !== 'provider') {
      continue
    }

    const identities = variable.provider_profiles?.length
      ? variable.provider_profiles
      : variable.provider
        ? [
            {
              provider: variable.provider,
              provider_label: variable.provider_label ?? variable.provider,
              primary: Boolean(variable.provider_primary),
              url: variable.url
            }
          ]
        : []

    for (const identity of identities) {
      const slug = identity.provider.trim().toLowerCase()

      if (!slug) {
        continue
      }

      const previous = hints.get(slug)
      const configured = variable.is_set || Boolean(previous?.configured)

      if (!previous || (identity.primary && !previous.primary)) {
        hints.set(slug, {
          key,
          label: identity.provider_label || slug,
          primary: identity.primary,
          configured,
          url: identity.url
        })
      } else {
        previous.configured = configured
      }
    }
  }

  const result = catalogProviders
    .filter(row => !isCustomModelProvider(row))
    .map(row => {
      const hint = hints.get(row.slug.toLowerCase())

      return hint
        ? {
            ...row,
            auth_type: 'api_key',
            key_env: hint.key,
            authenticated: row.authenticated ?? hint.configured,
            docs_url: hint.url
          }
        : row
    })

  for (const [slug, hint] of hints) {
    if (result.some(row => catalogProviderMatches(row, slug))) {
      continue
    }

    result.push({
      slug,
      name: hint.label,
      models: [],
      source: 'canonical',
      auth_type: 'api_key',
      key_env: hint.key,
      authenticated: hint.configured,
      docs_url: hint.url
    })
  }

  return result
}
