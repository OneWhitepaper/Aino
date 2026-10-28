import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n'

import { parseCatalog } from './catalog-data'
import { catalogDescription, catalogDisplayLabel } from './catalog-localization'
import { EMPTY_FACETS, filterCatalog } from './catalog-query'

describe('catalog display localization', () => {
  it('keeps source identities and original search available beside Chinese text', () => {
    const entries = parseCatalog('skills', [
      {
        name: 'Apple Notes',
        identifier: 'apple-notes',
        source: 'built-in',
        category: 'apple',
        description: 'Manage Apple Notes via memo CLI: create, search, edit.'
      }
    ])

    expect(filterCatalog(entries, EMPTY_FACETS, '备忘录', () => false, 'skills', TRANSLATIONS.zh)).toEqual(entries)
    expect(
      filterCatalog(entries, { ...EMPTY_FACETS, categories: ['apple'] }, '苹果', () => false, 'skills', TRANSLATIONS.zh)
    ).toEqual(entries)
    expect(filterCatalog(entries, EMPTY_FACETS, 'memo', () => false, 'skills', TRANSLATIONS.zh)).toEqual(entries)
    expect(catalogDescription(entries[0], TRANSLATIONS.en)).toBe(entries[0].description)
  })

  it('does not overwrite custom descriptions or resolve inherited object properties as translations', () => {
    const [entry] = parseCatalog('skills', [
      { name: 'apple-notes', source: 'local', description: 'This custom skill only exports encrypted notes.' }
    ])

    expect(catalogDescription(entry, TRANSLATIONS.zh)).toBe('This custom skill only exports encrypted notes.')
    expect(catalogDescription({ description: 'constructor' }, TRANSLATIONS.zh)).toBe('constructor')
    expect(catalogDisplayLabel('__proto__', TRANSLATIONS.zh)).toBe(' Proto ')
    expect(catalogDisplayLabel('future-vendor.example', TRANSLATIONS.zh)).toBe('future-vendor.example')
  })
})
