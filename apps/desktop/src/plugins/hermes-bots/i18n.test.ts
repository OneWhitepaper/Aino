/**
 * The English bundle is the message shape. ja / zh / zh-hant must cover the
 * same leaves so a locale switch never falls through to a raw key — and the
 * interpolators must still splice their arguments, not drop them.
 */

import { describe, expect, it } from 'vitest'

import { BOTS_LOCALES } from './i18n'

type Leaf = string | ((...args: never[]) => string)

function leafEntries(node: unknown, prefix = ''): Array<[string, Leaf]> {
  if (typeof node === 'function' || typeof node === 'string') {
    return [[prefix, node as Leaf]]
  }

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafEntries(value, prefix ? `${prefix}.${key}` : key)
  )
}

const en = BOTS_LOCALES.en
const ja = BOTS_LOCALES.ja
const zh = BOTS_LOCALES.zh
const zhHant = BOTS_LOCALES['zh-hant']

describe('BOTS_LOCALES', () => {
  it('covers the English key tree in every shipped locale', () => {
    expect(ja).toBeDefined()
    expect(zh).toBeDefined()
    expect(zhHant).toBeDefined()

    const enPaths = leafEntries(en).map(([path]) => path)

    expect(leafEntries(ja).map(([path]) => path)).toEqual(enPaths)
    expect(leafEntries(zh).map(([path]) => path)).toEqual(enPaths)
    expect(leafEntries(zhHant).map(([path]) => path)).toEqual(enPaths)
  })

  it('translates user-visible chrome instead of echoing English', () => {
    const samples = ['roster.emptyTitle', 'bot.newTitle', 'group.manageTitle', 'tools.skillsHub'] as const
    const enByPath = Object.fromEntries(leafEntries(en))

    for (const locale of [ja, zh, zhHant]) {
      const byPath = Object.fromEntries(leafEntries(locale))

      for (const path of samples) {
        expect(byPath[path]).not.toBe(enByPath[path])
      }
    }
  })

  it('covers the roster, row, and avatar controls used by the desktop shell', () => {
    const samples = [
      'roster.newMenu',
      'roster.activityToastsOn',
      'roster.filterRoster',
      'roster.globalGroupChats',
      'roster.currentGateway',
      'roster.staleRefresh',
      'roster.gatewayUnreachable',
      'roster.newMessageFor',
      'roster.hasNewActivity',
      'roster.openChatToSeeIt',
      'roster.deleteDescription',
      'roster.deletedProfile',
      'bot.pinToTop',
      'bot.unpin',
      'bot.manageGroups',
      'bot.duplicating',
      'bot.chatOpenFailed',
      'bot.updateGatewayTitle',
      'bot.updateGatewayMessage',
      'bot.attentionProviderAuth',
      'group.newConversationHint',
      'group.attachmentTooLarge',
      'group.you',
      'group.botCount',
      'group.availability',
      'avatar.lockFace',
      'avatar.faceLocked',
      'avatar.noImageModel',
      'avatar.chooseImage',
      'bot.createDescription',
      'bot.remoteCreateHint',
      'bot.capabilitiesImmediate',
      'tools.browseHub',
      'tools.hubHint',
      'mcp.saveTest',
      'mcp.setupNeeded',
      'model.backToDropdowns',
      'model.inheritLaunch',
      'cron.jobDescription',
      'cron.detailStatus',
      'cron.pausedSecurity',
      'cron.onceMinutes'
    ] as const

    const enByPath = Object.fromEntries(leafEntries(en))
    const zhByPath = Object.fromEntries(leafEntries(zh))

    for (const path of samples) {
      expect(zhByPath[path], path).toBeDefined()
      expect(zhByPath[path], path).not.toBe(enByPath[path])
    }
  })

  it('keeps the Agent Hub brand label stable across locales', () => {
    for (const locale of [en, ja, zh, zhHant]) {
      const byPath = Object.fromEntries(leafEntries(locale))

      expect(byPath['roster.title']).toBe('Agent Hub')
    }
  })

  it('localizes the skill hub install affordance for Chinese users', () => {
    const zhByPath = Object.fromEntries(leafEntries(zh))

    expect(zhByPath['tools.hubHint']).toBe(
      '点击任意技能上的“+ 添加到此智能体”即可安装，安装后会出现在上方列表中。拖动角落可调整大小。'
    )
  })

  it('localizes the forever-chat reset guard for Chinese users', () => {
    const zhByPath = Object.fromEntries(leafEntries(zh))

    expect(zhByPath['bot.foreverChatTitle']).toBe('此聊天不会重置')
    expect(zhByPath['bot.foreverChatMessage']).toBe(
      '机器人聊天会持续保留上下文，因此将改为压缩当前上下文。若要与此机器人开启临时会话，请使用“会话”模式。'
    )
  })

  it('localizes profile-operation and stored-session guards for Chinese users', () => {
    const zhByPath = Object.fromEntries(leafEntries(zh))

    expect(zhByPath['bot.duplicateNameExhausted']).toBe('没有可用的复制名称。')
    expect(zhByPath['bot.defaultDeleteBlocked']).toBe('默认工作区不能删除。')
    expect(zhByPath['bot.remoteDeleteUnsupported']).toBe('当前桌面端暂不支持删除来源限定的工作区。')
    expect(zhByPath['bot.storedSessionOpenUnsupported']).toBe('当前桌面版本无法打开已保存的会话。')
    expect(
      (zhByPath['bot.registryCheckFailed'] as (name: string, detail: string) => string)('研究员', '网关超时')
    ).toBe('无法检查 研究员 的机器人聊天注册表（网关超时） — 不会启动新聊天')
  })

  it('localizes the roster disband confirmation description for Chinese users', () => {
    const zhByPath = Object.fromEntries(leafEntries(zh))
    const description = zhByPath['group.disbandDescription'] as (group: string) => string

    expect(description('研究组')).toBe('这会从机器人中移除“研究组”并清空共享房间日志。机器人及其各自的聊天会保留。')
  })

  it('provides localized labels for the Bot Mode palette action', () => {
    const zhByPath = Object.fromEntries(leafEntries(zh))

    expect(zhByPath['bot.newCommand']).toBe('新建机器人…')
  })

  it('keeps interpolator arguments in the translated string', () => {
    const sentinel = 'QUERY_SENTINEL'
    const gateway = 'GATEWAY_SENTINEL'

    for (const locale of [en, ja, zh, zhHant]) {
      const byPath = Object.fromEntries(leafEntries(locale))
      const queryFn = byPath['roster.noMatchQuery'] as (query: string) => string
      const bothFn = byPath['roster.noMatchQueryOn'] as (query: string, gateway: string) => string
      const reasonFn = byPath['roster.rosterUnavailable'] as (reason: string) => string

      expect(queryFn(sentinel)).toContain(sentinel)
      expect(bothFn(sentinel, gateway)).toContain(sentinel)
      expect(bothFn(sentinel, gateway)).toContain(gateway)
      expect(reasonFn(sentinel)).toContain(sentinel)
    }
  })
})
