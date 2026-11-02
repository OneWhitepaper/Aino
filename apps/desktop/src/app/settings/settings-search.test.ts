import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n'
import { Settings2, Wrench } from '@/lib/icons'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import {
  buildConfigSearchEntries,
  buildCredentialSearchEntries,
  credentialSettingsView,
  filterSettingsSearchEntries,
  settingsSearchTargetQuery
} from './settings-search'
import { envVar } from './test-utils'

const searchCopy = {
  fieldDescriptions: {
    'display.personality': 'Choose how Hermes sounds in conversation.',
    'tts.edge.voice': 'Voice used by Edge TTS.'
  },
  fieldLabels: {
    'display.personality': 'Personality',
    'tts.edge.voice': 'Edge voice',
    'tts.openai.voice': 'OpenAI voice'
  },
  sections: {
    chat: 'Chat',
    voice: 'Voice'
  }
}

describe('settings search index', () => {
  it.each(['third-party', 'custom-endpoints', 'local'] as const)(
    'preserves a direct %s model-service destination',
    providerView => {
      const query = new URLSearchParams(settingsSearchTargetQuery({ view: 'providers', providerView }))
      expect(query.get('tab')).toBe('providers')
      expect(query.get('pview')).toBe(providerView)
    }
  )

  it('builds config results from renderable schema fields with exact deep links', () => {
    const schema: Record<string, ConfigFieldSchema> = {
      'display.personality': { type: 'select' },
      'tts.edge.voice': { type: 'string' },
      'tts.openai.voice': { type: 'string' }
    }

    const config = {
      display: { personality: 'default' },
      tts: { provider: 'edge', edge: { voice: '' }, openai: { voice: '' } }
    } as unknown as HermesConfigRecord

    const entries = buildConfigSearchEntries(schema, config, searchCopy)

    expect(entries.map(entry => entry.id)).toEqual([
      'config-field:display.personality',
      'config-field:tts.provider',
      'config-field:tts.edge.voice'
    ])
    expect(entries[0]).toMatchObject({
      context: 'Chat',
      description: 'Choose how Hermes sounds in conversation.',
      label: 'Personality',
      target: { field: 'display.personality', view: 'config:chat' }
    })
    expect(entries.some(entry => entry.id === 'config-field:tts.openai.voice')).toBe(false)
  })

  it('discovers future tool and setting entries entirely from backend metadata', () => {
    const vars = {
      FUTURE_CRAWLER_API_KEY: envVar('tool', {
        description: 'Fetch structured pages from a new crawler.',
        tools: ['future_crawl'],
        url: 'https://future.example/keys'
      }),
      FUTURE_GATEWAY_URL: envVar('setting', { description: 'Route gateway traffic.' }),
      TELEGRAM_BOT_TOKEN: envVar('messaging', { channel_managed: true }),
      MODEL_PROVIDER_API_KEY: envVar('provider')
    }

    const entries = buildCredentialSearchEntries(
      vars,
      { settings: 'Settings', tools: 'Tools' },
      { settings: Settings2, tools: Wrench }
    )

    expect(entries.map(entry => entry.id)).toEqual([
      'credential:FUTURE_CRAWLER_API_KEY',
      'credential:FUTURE_GATEWAY_URL'
    ])
    expect(entries[0]).toMatchObject({
      context: 'Tools',
      label: 'FUTURE CRAWLER',
      target: { key: 'FUTURE_CRAWLER_API_KEY', keysView: 'tools', view: 'keys' }
    })
    expect(filterSettingsSearchEntries(entries, 'structured crawler')).toHaveLength(1)
    expect(filterSettingsSearchEntries(entries, 'future_crawl')[0]?.id).toBe('credential:FUTURE_CRAWLER_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'gateway traffic')[0]?.id).toBe('credential:FUTURE_GATEWAY_URL')
  })

  it('uses the approved page copy while keeping old labels and descriptions searchable', () => {
    const copy = {
      ...searchCopy,
      configPages: {
        ...TRANSLATIONS.en.settings.configPages,
        fields: {
          'display.personality': { label: 'Reply style', description: 'Set the default tone for new conversations.' }
        }
      }
    }

    const schema: Record<string, ConfigFieldSchema> = {
      'display.personality': { type: 'select' },
      'tts.edge.voice': { type: 'string' }
    }

    const entries = buildConfigSearchEntries(schema, { display: { personality: 'default' } }, copy)
    const personality = entries.find(entry => entry.target.field === 'display.personality')!
    expect(personality.label).toBe('Reply style')
    expect(personality.description).toBe('Set the default tone for new conversations.')
    expect(personality.target).toEqual({ field: 'display.personality', view: 'config:chat' })

    for (const query of ['Reply style', 'default tone', 'Personality', 'Hermes sounds']) {
      expect(filterSettingsSearchEntries(entries, query)).toContain(personality)
    }

    expect(entries.find(entry => entry.target.field === 'tts.edge.voice')).toMatchObject({
      label: 'Edge voice',
      description: 'Voice used by Edge TTS.'
    })
  })

  it('shares the Tools and Settings category boundary with the rendered page', () => {
    expect(credentialSettingsView(envVar('tool'))).toBe('tools')
    expect(credentialSettingsView(envVar('setting'))).toBe('settings')
    expect(credentialSettingsView(envVar('messaging'))).toBe('settings')
    expect(credentialSettingsView(envVar('messaging', { channel_managed: true }))).toBeNull()
    expect(credentialSettingsView(envVar('provider'))).toBeNull()
  })

  it('uses AND matching across labels, context, descriptions, and raw keys', () => {
    const entries = buildCredentialSearchEntries(
      {
        BRAVE_SEARCH_API_KEY: envVar('tool', { description: 'Search public web pages.' }),
        FIRECRAWL_API_KEY: envVar('tool', { description: 'Extract public web pages.' })
      },
      { settings: 'Settings', tools: 'Tools' },
      { settings: Settings2, tools: Wrench }
    )

    expect(filterSettingsSearchEntries(entries, 'brave tools')[0]?.id).toBe('credential:BRAVE_SEARCH_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'firecrawl extract')[0]?.id).toBe('credential:FIRECRAWL_API_KEY')
    expect(filterSettingsSearchEntries(entries, 'brave extract')).toEqual([])
  })
})
