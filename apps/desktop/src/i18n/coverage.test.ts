import { describe, expect, it } from 'vitest'

import { SECTIONS } from '@/app/settings/constants'
import { BUILTIN_THEME_LIST } from '@/themes/presets'

import { en } from './en'
import { zh } from './zh'

interface EnglishLeaf {
  key: string
  value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCompleteEnglishSentence(value: string): boolean {
  if (/\p{Script=Han}/u.test(value) || /https?:\/\//.test(value)) {
    return false
  }

  const words = value.match(/[A-Za-z]{2,}/g) ?? []

  return words.length >= 3 && /[.!?…]$/.test(value.trim())
}

function findEnglishOnlyLeaves(english: unknown, simplifiedChinese: unknown, prefix = ''): EnglishLeaf[] {
  if (typeof english === 'string' && typeof simplifiedChinese === 'string') {
    return english === simplifiedChinese && isCompleteEnglishSentence(simplifiedChinese)
      ? [{ key: prefix, value: simplifiedChinese }]
      : []
  }

  if (!isRecord(english) || !isRecord(simplifiedChinese)) {
    return []
  }

  return Object.keys(english).flatMap(key =>
    findEnglishOnlyLeaves(english[key], simplifiedChinese[key], prefix ? `${prefix}.${key}` : key)
  )
}

function findMissingLeaves(english: unknown, simplifiedChinese: unknown, prefix = ''): EnglishLeaf[] {
  if (typeof english === 'string' || typeof english === 'function') {
    return simplifiedChinese === undefined
      ? [{ key: prefix, value: typeof english === 'function' ? '[function]' : english }]
      : []
  }

  if (!isRecord(english)) {
    return []
  }

  return Object.keys(english).flatMap(key =>
    findMissingLeaves(
      english[key],
      isRecord(simplifiedChinese) ? simplifiedChinese[key] : undefined,
      prefix ? `${prefix}.${key}` : key
    )
  )
}

describe('Simplified Chinese catalog coverage', () => {
  it('defines every English catalog leaf in Simplified Chinese', () => {
    expect(findMissingLeaves(en, zh)).toEqual([])
  })

  it('defines a Simplified Chinese label for every rendered settings section', () => {
    const missing = SECTIONS.filter(section => !zh.settings.sections[section.id]).map(section => section.id)

    expect(missing).toEqual([])
  })

  it('defines Simplified Chinese copy for every built-in theme', () => {
    const missing = BUILTIN_THEME_LIST.filter(theme => !zh.settings.appearance.themePresets[theme.name]).map(
      theme => theme.name
    )

    expect(missing).toEqual([])
  })

  it('does not leave complete English sentences in the Chinese catalog', () => {
    expect(findEnglishOnlyLeaves(en, zh)).toEqual([])
  })

  it('localizes the Webhook URL label for Chinese users', () => {
    expect(zh.webhooks.webhookUrl).not.toBe(en.webhooks.webhookUrl)
    expect(zh.webhooks.webhookUrl).toMatch(/\p{Script=Han}/u)
  })
})
