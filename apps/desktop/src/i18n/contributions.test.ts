import { describe, expect, it } from 'vitest'

import { dropPlugin, publishPlugin } from '@/contrib/plugins-store'

import {
  localizedPaletteDetail,
  localizedPaletteLabel,
  localizedPaneTitle
} from './contributions'
import { en } from './en'
import { zh } from './zh'

describe('core contribution display copy', () => {
  it('localizes the built-in pane titles without changing plugin titles', () => {
    expect(localizedPaneTitle(zh, 'sessions', 'sessions', undefined)).toBe('会话')
    expect(localizedPaneTitle(zh, 'terminal', 'terminal', 'core')).toBe('终端')
    expect(localizedPaneTitle(zh, 'terminal', 'Custom terminal', 'plugin:custom')).toBe('Custom terminal')
  })

  it('uses explicit localized metadata for a plugin pane while preserving unknown plugin titles', () => {
    publishPlugin({
      id: 'hermes-bots',
      kind: 'bundled',
      localized: { zh: { name: '机器人' } },
      name: 'Bots',
      status: 'loaded'
    })

    try {
      expect(localizedPaneTitle(zh, 'hermes-bots:pane', 'Bots', 'plugin:hermes-bots', 'zh')).toBe('机器人')
      expect(localizedPaneTitle(zh, 'custom:pane', 'Custom pane', 'plugin:custom', 'zh')).toBe('Custom pane')
    } finally {
      dropPlugin('hermes-bots')
    }
  })

  it('resolves palette labels from the active locale and falls back for plugins', () => {
    expect(localizedPaletteLabel(zh, 'view.toggleTabStrip', 'Toggle tabs', undefined)).toBe(
      zh.commandCenter.contributedActions.toggleTabs
    )
    expect(localizedPaletteLabel(en, 'view.toggleTabStrip', 'Toggle tabs', 'core')).toBe(
      en.commandCenter.contributedActions.toggleTabs
    )
    expect(localizedPaletteLabel(zh, 'plugin:custom:action', 'Custom action', 'plugin:custom')).toBe('Custom action')
  })

  it('localizes dynamically generated core strip-tab labels', () => {
    expect(localizedPaletteLabel(zh, 'strip-tab.hermes-bots:pane', 'Toggle 机器人 tab', undefined)).toBe(
      '切换 机器人 标签'
    )
  })

  it('localizes binary palette state details', () => {
    expect(localizedPaletteDetail(zh, 'on')).toBe('开')
    expect(localizedPaletteDetail(zh, 'off')).toBe('关')
    expect(localizedPaletteDetail(zh, 'custom state')).toBe('custom state')
    expect(localizedPaletteDetail(zh, undefined)).toBeUndefined()
  })
})
