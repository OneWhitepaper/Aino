import { expect, it } from 'vitest'

import type { EnvVarInfo } from '@/types/hermes'

import { isCustomModelProvider, officialModelProviders } from './model-provider-source'

function credential(overrides: Partial<EnvVarInfo> = {}): EnvVarInfo {
  return {
    advanced: false,
    category: 'provider',
    description: '',
    is_password: true,
    is_set: false,
    redacted_value: null,
    tools: [],
    url: null,
    ...overrides
  }
}

it('merges canonical credential metadata into connected and unconfigured providers', () => {
  const providers = officialModelProviders(
    [{ slug: 'openrouter', name: 'OpenRouter', models: ['model-a'], authenticated: true }],
    {
      OPENROUTER_API_KEY: credential({ provider: 'openrouter', provider_label: 'OpenRouter', provider_primary: true }),
      SHARED_ALIAS_KEY: credential({
        is_set: true,
        provider_profiles: [
          { provider: 'widget', provider_label: 'Widget', primary: false, description: '', url: null },
          { provider: 'widget-cn', provider_label: 'Widget CN', primary: true, description: '', url: null }
        ]
      }),
      WIDGET_API_KEY: credential({ provider: 'widget', provider_label: 'Widget', provider_primary: true }),
      WIDGET_BASE_URL: credential({ provider: 'widget', is_password: false })
    }
  )

  expect(providers.find(row => row.slug === 'openrouter')).toMatchObject({
    models: ['model-a'],
    authenticated: true,
    auth_type: 'api_key',
    key_env: 'OPENROUTER_API_KEY'
  })
  expect(providers.find(row => row.slug === 'widget')).toMatchObject({ authenticated: true, key_env: 'WIDGET_API_KEY' })
  expect(providers.find(row => row.slug === 'widget-cn')).toMatchObject({ key_env: 'SHARED_ALIAS_KEY' })
})

it('keeps a canonical-looking saved custom endpoint separate from official credentials', () => {
  const custom = {
    slug: 'deepseek',
    name: '私有 DeepSeek',
    models: ['private-model'],
    is_user_defined: true,
    source: 'user-config',
    aliases: ['custom:deepseek']
  }

  expect(isCustomModelProvider(custom)).toBe(true)
  expect(
    officialModelProviders([custom], {
      DEEPSEEK_API_KEY: credential({ provider: 'deepseek', provider_label: 'DeepSeek', provider_primary: true })
    })
  ).toEqual([expect.objectContaining({ slug: 'deepseek', name: 'DeepSeek', models: [], key_env: 'DEEPSEEK_API_KEY' })])
  expect(
    officialModelProviders(
      [
        { ...custom, slug: 'custom:deepseek', aliases: null },
        { slug: 'deepseek', name: 'DeepSeek', models: ['official-model'] }
      ],
      { DEEPSEEK_API_KEY: credential({ provider: 'deepseek', provider_primary: true }) }
    )
  ).toEqual([expect.objectContaining({ slug: 'deepseek', models: ['official-model'], key_env: 'DEEPSEEK_API_KEY' })])
})
