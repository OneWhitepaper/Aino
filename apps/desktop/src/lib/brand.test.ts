import { describe, expect, it } from 'vitest'

import {
  AGENT_NAME,
  APP_ID,
  applyProductBrand,
  brandTranslationTree,
  HOME_DIR_NAME,
  LEGACY_PROTOCOL,
  PRODUCT_NAME
} from './brand'

describe('Aino product brand overlay', () => {
  it('exposes the independent product identity', () => {
    expect(PRODUCT_NAME).toBe('Aino')
    expect(AGENT_NAME).toBe('Aino Agent')
    expect(APP_ID).toBe('com.ablankpaper.aino')
  })

  it('keeps the Aino data root and legacy protocol boundary explicit', () => {
    expect(HOME_DIR_NAME).toBe('aino')
    expect(LEGACY_PROTOCOL).toBe('hermes')
  })

  it('rebrands visible product labels while preserving compatibility snippets', () => {
    expect(applyProductBrand('Hermes Desktop is ready')).toBe('Aino is ready')
    expect(applyProductBrand('Hermes Agent uses ~/.hermes and `hermes gateway`')).toBe(
      'Aino Agent uses ~/.hermes and `hermes gateway`'
    )
    expect(applyProductBrand('Hermes Cloud is unavailable')).toBe('Nous Cloud is unavailable')
  })

  it('wraps dynamic and nested translation values without changing shape', () => {
    const branded = brandTranslationTree({
      heading: 'About Hermes Desktop',
      nested: { message: (count: number) => `${count} Hermes tasks` },
      suggestions: (label: string) => [`${label}: Hermes Desktop`, 'Use `hermes tools`']
    })

    expect(branded.heading).toBe('About Aino')
    expect(branded.nested.message(3)).toBe('3 Aino tasks')
    expect(branded.suggestions('My Custom Voice')).toEqual(['My Custom Voice: Aino', 'Use `hermes tools`'])
  })
})
