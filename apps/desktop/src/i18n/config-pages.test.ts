import { describe, expect, it } from 'vitest'

import { SECTIONS } from '@/app/settings/constants'

import { TRANSLATIONS } from './catalog'
import { fieldTemplates } from './config-pages-templates'

const pages = ['chat', 'safety', 'browser', 'memory', 'voice', 'advanced']
const renderedKeys = SECTIONS.filter(section => pages.includes(section.id)).flatMap(section => section.keys)

describe('configuration page copy', () => {
  it('keeps readable labels and explanations for every existing field in every bundled language', () => {
    const unreadable: string[] = []

    for (const [locale, catalog] of Object.entries(TRANSLATIONS)) {
      const fields = catalog.settings.configPages.fields

      for (const key of renderedKeys) {
        expect(fields[key]?.label, locale + ': ' + key).toBeTruthy()

        if (fields[key]?.label === key) {
          unreadable.push(locale + ': ' + key)
        }

        expect(fields[key]?.description, locale + ': ' + key).toBeTruthy()

        if (fields[key]?.description === fieldTemplates[locale as keyof typeof fieldTemplates].missing) {
          unreadable.push(locale + ': ' + key + ' description')
        }
      }
    }

    expect(unreadable).toEqual([])
  })

  it('explains the messaging-only speech switch and raw audio bitrate without changing their meaning', () => {
    const fields = TRANSLATIONS.zh.settings.configPages.fields

    expect(fields['voice.auto_tts']?.description).toContain('消息平台')
    expect(fields['voice.auto_tts']?.help).toContain('桌面')
    expect(fields['stt.echo_transcripts']?.help).toContain('不控制桌面')
    expect(fields['tts.xai.bit_rate']?.unit).toBe('bitsPerSecond')
    expect(fields['browser.auto_local_for_private_urls']?.help).toContain('不自动带入')
    expect(fields['security.redact_secrets']?.help).toContain('重启')
  })
})
