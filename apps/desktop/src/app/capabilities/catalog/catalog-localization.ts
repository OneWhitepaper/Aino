import { isOfficialSkillSource } from '@hermes/shared'

import type { Translations } from '@/i18n'
import { AGENT_NAME } from '@/lib/brand'

import { type CatalogEntry, catalogLabel } from './catalog-data'

/** The built-in product guide gets the product brand, never a new install identity.
 * Community names and repository identifiers are authored by their owners. */
export function catalogDisplayName(entry: Pick<CatalogEntry, 'name' | 'source'>): string {
  return isOfficialSkillSource(entry.source) && /^hermes[- ]agent$/i.test(entry.name) ? AGENT_NAME : entry.name
}

/** Display only: facet values, installation IDs and source text stay untouched. */
export function catalogDisplayLabel(value: string, t: Translations): string {
  const key = value.trim().toLowerCase().replace(/[ _]+/g, '-')

  return Object.hasOwn(t.catalog.contentLabels, key) ? t.catalog.contentLabels[key] : catalogLabel(value)
}

export function catalogDescription(entry: Pick<CatalogEntry, 'description'>, t: Translations): string {
  const key = entry.description.trim()

  return Object.hasOwn(t.catalog.descriptions, key) ? t.catalog.descriptions[key] : entry.description
}

export function catalogSearchText(entry: CatalogEntry, t: Translations): string {
  return [
    catalogDisplayName(entry),
    catalogDescription(entry, t),
    catalogDisplayLabel(entry.category, t),
    catalogDisplayLabel(entry.categoryLabel, t),
    catalogDisplayLabel(entry.source, t),
    ...entry.tags.map(tag => catalogDisplayLabel(tag, t))
  ]
    .join(' ')
    .toLowerCase()
}
