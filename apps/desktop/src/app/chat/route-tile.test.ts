import { beforeEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import { ARTIFACTS_ROUTE, CAPABILITIES_ROUTE, MESSAGING_ROUTE } from '../routes'

import { routeTitle } from './route-tile'

describe('route tile titles', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('zh')
  })

  it('uses localized titles for built-in pages', () => {
    expect(routeTitle(ARTIFACTS_ROUTE)).toBe('产物')
    expect(routeTitle(MESSAGING_ROUTE)).toBe('消息平台')
    expect(routeTitle(CAPABILITIES_ROUTE)).toBe('能力')
  })
})
