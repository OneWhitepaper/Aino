import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n'

import { localizedBlueprintDisplayDefaults, localizedBlueprintField } from './blueprint-copy'

describe('localized blueprint field copy', () => {
  it('localizes labels, help, and option display names without changing values', () => {
    const field = {
      name: 'recurrence',
      type: 'weekdays' as const,
      label: 'Repeat on',
      default: 'weekdays',
      options: ['everyday', 'weekdays', 'weekends'],
      optional: false,
      help: ''
    }

    const localized = localizedBlueprintField('custom-reminder', field, TRANSLATIONS.zh)

    expect(localized.label).toBe('重复日期')
    expect(localized.help).toBe('')
    expect(localized.options).toEqual(['everyday', 'weekdays', 'weekends'])
    expect(localized.optionLabels).toEqual({ everyday: '每天', weekdays: '工作日', weekends: '周末' })
  })

  it('provides a translated display default for text slots', () => {
    const field = {
      name: 'topic',
      type: 'text' as const,
      label: 'What topic?',
      default: 'AI and technology',
      options: [],
      optional: false,
      help: 'a subject, product, person, or search phrase'
    }

    expect(localizedBlueprintField('news-digest', field, TRANSLATIONS.zh).displayDefault).toBe('人工智能与科技')
  })

  it('keeps backend text for unknown fields and blueprint keys', () => {
    const field = {
      name: 'plugin_slot',
      type: 'text' as const,
      label: 'Plugin slot',
      default: null,
      options: [],
      optional: false,
      help: 'Provided by a plugin.'
    }

    expect(localizedBlueprintField('plugin-blueprint', field, TRANSLATIONS.zh)).toMatchObject({
      label: 'Plugin slot',
      help: 'Provided by a plugin.'
    })
  })

  it('collects translated defaults only for displayable text slots', () => {
    const blueprint = {
      key: 'news-digest',
      title: 'News',
      description: '',
      category: 'general',
      tags: [],
      command: '',
      appUrl: '',
      fields: [
        {
          name: 'topic',
          type: 'text' as const,
          label: 'Topic',
          default: 'AI and technology',
          options: [],
          optional: false,
          help: ''
        },
        {
          name: 'time',
          type: 'time' as const,
          label: 'What time?',
          default: '18:00',
          options: [],
          optional: false,
          help: ''
        }
      ]
    }

    expect(localizedBlueprintDisplayDefaults(blueprint, TRANSLATIONS.zh)).toEqual({ topic: '人工智能与科技' })
  })
})
