import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import { type GatewayRequest, installAgentPlugin } from './agent-plugins'

describe('installAgentPlugin', () => {
  beforeEach(() => {
    setRuntimeI18nLocale('en')
  })

  afterEach(() => {
    setRuntimeI18nLocale('en')
    vi.restoreAllMocks()
  })

  it('uses Simplified Chinese copy when the backend omits an install error', async () => {
    setRuntimeI18nLocale('zh')
    const request = vi.fn().mockResolvedValue({ ok: false }) as unknown as GatewayRequest

    await expect(installAgentPlugin(request, { identifier: 'example/plugin' })).resolves.toEqual({
      error: '智能体插件安装失败',
      ok: false,
      live: { mcpServers: [], skills: [] },
      nextChat: false
    })
  })
})
