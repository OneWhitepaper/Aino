import identity from '../../brand.json'

export const PRODUCT_NAME = identity.productName
export const AGENT_NAME = identity.agentName
export const APP_ID = identity.appId
export const HOME_DIR_NAME = identity.homeDirName
export const PRIMARY_PROTOCOL = identity.primaryProtocol
export const LEGACY_PROTOCOL = identity.legacyProtocol
export const REPOSITORY_URL = identity.repositoryUrl
export const WEBSITE_URL = identity.websiteUrl
export const DOWNLOAD_URL = identity.downloadUrl
export const DOCUMENTATION_URL = identity.documentationUrl
export const ISSUES_URL = `${REPOSITORY_URL}/issues`
export const RELEASES_URL = `${REPOSITORY_URL}/releases`
export const UPSTREAM_REPOSITORY_URL = identity.upstreamRepositoryUrl
export const REPOSITORY_PATH = REPOSITORY_URL.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')

/**
 * Replace only the product-facing Hermes labels in a translated message.
 *
 * Code spans are intentionally left untouched: commands (`hermes`), paths
 * (`~/.hermes`), protocol examples, and RPC identifiers remain compatibility
 * documentation even while the surrounding product copy is branded Aino.
 */
export function applyProductBrand(text: string, preservedValues: readonly unknown[] = []): string {
  const codeSpan = /(`+[^`]*`+)/g

  // Interpolated names belong to the user or provider, even when they contain
  // the old product name. Rebrand only the surrounding copy-owned segments.
  const preserved = preservedValues
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)

  const values = preserved.length
    ? new RegExp(`(${preserved.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
    : null

  return text
    .split(codeSpan)
    .map((segment, index) => {
      if (index % 2 === 1) {
        return segment
      }

      return (values ? segment.split(values) : [segment])
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part
                .replace(/\bHermes Desktop\b/g, PRODUCT_NAME)
                .replace(/\bHermes Agent\b/g, AGENT_NAME)
                .replace(/\bHermes Cloud\b/g, 'Nous Cloud')
                .replace(/\bHermes\b/g, PRODUCT_NAME)
        )
        .join('')
    })
    .join('')
}

/**
 * Apply the Aino overlay to a nested translation tree without changing the
 * source locale files. Keeping this as a small runtime layer makes upstream
 * locale syncs low-conflict while every newly added product label is covered.
 */
export function brandTranslationTree<T>(value: T, preservedValues: readonly unknown[] = []): T {
  if (typeof value === 'string') {
    return applyProductBrand(value, preservedValues) as T
  }

  if (typeof value === 'function') {
    const translate = value as (...args: unknown[]) => unknown

    return ((...args: unknown[]) => brandTranslationTree(translate(...args), [...preservedValues, ...args])) as T
  }

  if (Array.isArray(value)) {
    return value.map(entry => brandTranslationTree(entry, preservedValues)) as T
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}

    for (const [key, entry] of Object.entries(value)) {
      result[key] = brandTranslationTree(entry, preservedValues)
    }

    return result as T
  }

  return value
}
