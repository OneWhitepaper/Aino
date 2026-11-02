import type { ModelOptionProvider } from '@hermes/shared'

import { findCatalogProvider } from '@/lib/model-options'

import type { DefaultMainModelSource } from './default-main-model'
import { isCustomModelProvider } from './model-provider-source'

export function appliedMainModelSource(
  main: { provider: string; model: string } | null,
  providers: readonly ModelOptionProvider[]
): DefaultMainModelSource {
  const appliedRow = findCatalogProvider(providers, main?.provider ?? '')

  return main?.model || main?.provider
    ? (appliedRow && isCustomModelProvider(appliedRow)) || /^(custom(?::|$)|local$)/i.test(main?.provider ?? '')
      ? 'custom'
      : 'provider'
    : 'aino'
}
