// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import * as mcpTab from './mcp-tab'

type ParseServersDoc = (raw: string) => Record<string, unknown>

const parseServersDoc = (mcpTab as unknown as { parseServersDoc?: ParseServersDoc }).parseServersDoc

describe('MCP document parser localization', () => {
  afterEach(() => {
    setRuntimeI18nLocale('en')
  })

  it('localizes non-object JSON input for Simplified Chinese users', () => {
    setRuntimeI18nLocale('zh')

    expect(parseServersDoc).toBeTypeOf('function')
    expect(() => parseServersDoc?.('[1, 2]')).toThrow('应为 JSON 对象')
  })

  it('localizes the named-server wrapper guidance for Simplified Chinese users', () => {
    setRuntimeI18nLocale('zh')

    expect(parseServersDoc).toBeTypeOf('function')
    expect(() => parseServersDoc?.('{"command":"npx"}')).toThrow('请将服务器包裹在')
  })
})
