// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import { parseServersDoc } from './mcp-doc'

describe('MCP document parser localization', () => {
  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('localizes non-object JSON input for Simplified Chinese users', () => {
    setRuntimeI18nLocale('zh')

    expect(() => parseServersDoc('[1, 2]')).toThrow('应为 JSON 对象')
  })

  it('localizes the named-server wrapper guidance for Simplified Chinese users', () => {
    setRuntimeI18nLocale('zh')

    expect(() => parseServersDoc('{"command":"npx"}')).toThrow('请将服务器包裹在')
  })
})
