/**
 * notifyBotOpenFailure copy contract (desktop-34): every failed bot open
 * toasts a plain-words title + next step from the plugin bundle, keeps the raw
 * RPC/connection error in `detail` only, never says "gateway", and offers the
 * the appropriate recovery surface as its action.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const { hostMock, pluginCtx } = vi.hoisted(() => ({
  hostMock: {
    navigate: vi.fn(),
    notify: vi.fn(),
    notifyError: vi.fn(),
    openSession: vi.fn(),
    openModelSettings: undefined as unknown,
    request: vi.fn(),
    revealPane: vi.fn()
  },
  pluginCtx: { current: null as null | { i18n?: { t: (key: string, ...args: unknown[]) => string } } }
}))

vi.mock('@hermes/plugin-sdk', async () => ({
  BOT_CHAT_SESSION_HYDRATION_TIMEOUT_MS: 15_000,
  host: hostMock,
  translateNow: (await import('@/i18n')).translateNow,
  usePluginI18n: () => (key: string) => key
}))

vi.mock('./routing', () => ({
  backendTargetProfile: (route: { targetProfile?: string } | null, name: string) => route?.targetProfile ?? name,
  botConnectionRoute: (bot: RosterRow) => bot?.route ?? null,
  botRosterMeta: () => ({}),
  botWorkspaceOwnerKey: (bot: { name?: string } | null) => `bot:${bot?.name || 'default'}`,
  requestForBot: vi.fn()
}))

vi.mock('./data', () => ({
  $botMeta: { get: () => ({}), set: vi.fn() },
  botMetaKey: (bot: { name?: string }) => bot?.name ?? '',
  botOwner: (owner: RosterRow | string) =>
    typeof owner === 'string'
      ? { bot: { name: owner }, key: owner, name: owner, route: null }
      : { bot: owner, key: owner?.name, name: owner?.name, route: null },
  persistBotMetaSnapshot: vi.fn(),
  saveBotMeta: vi.fn()
}))

vi.mock('./shared', () => ({ getPluginCtx: () => pluginCtx.current }))
vi.mock('./bot-state', async () => ({ $editingBot: (await import('nanostores')).atom(null) }))

type Toast = {
  kind?: string
  title?: string
  message: string
  detail?: string
  action?: { label: string; onClick: () => void }
}

const BOT = { connectionId: 'studio', connectionLabel: 'Studio Mac', name: 'ops' } as RosterRow

const lastToast = (): Toast => hostMock.notify.mock.calls[hostMock.notify.mock.calls.length - 1][0] as Toast

async function load() {
  vi.resetModules()

  return import('./canonical-chat')
}

beforeEach(() => {
  vi.clearAllMocks()
  pluginCtx.current = null
  hostMock.openModelSettings = undefined
})

describe('notifyBotOpenFailure', () => {
  it.each(['platform_account_changed', 'stale_account_revision', 'not_authenticated'])(
    'sends %s to the existing account recovery page',
    async code => {
      const { notifyBotOpenFailure } = await load()
      notifyBotOpenFailure(Object.assign(new Error('账户需要检查'), { code }), BOT, 'open')
      const toast = lastToast()
    expect(toast.action?.label).toBe('My Account')
      await toast.action?.onClick()
      expect(hostMock.navigate).toHaveBeenCalledWith('/settings?tab=account')
      expect(hostMock.revealPane).not.toHaveBeenCalled()
    }
  )

  it('keeps a structured unsupported runtime failure on the connection update recovery', async () => {
    const { notifyBotOpenFailure } = await load()
    notifyBotOpenFailure(Object.assign(new Error('运行服务不支持'), { code: 'unsupported_gateway' }), BOT, 'open')
    const toast = lastToast()
    expect(toast.message).toContain('Update Studio Mac')
    await toast.action?.onClick()
    expect(hostMock.navigate).toHaveBeenCalledWith('/settings?tab=gateway')
  })

  it.each([false, true])('uses structured model errors despite translated messages (wrapped: %s)', async wrapped => {
    const { notifyBotOpenFailure } = await load()
    const route = { connectionId: 'local', mode: 'local' as const, profile: 'ops-alias', targetProfile: 'ops' }
    const error = Object.assign(new Error('模型不可用'), { code: 'model_unavailable' })
    hostMock.openModelSettings = vi.fn(() => true)

    notifyBotOpenFailure(wrapped ? new Error('Request failed', { cause: error }) : error, { ...BOT, route }, 'open')
    const toast = lastToast()

    expect(toast.action?.label).toBe('Configure model')
    await toast.action?.onClick()
    expect(hostMock.openModelSettings).toHaveBeenCalledWith(route)
    expect(hostMock.navigate).not.toHaveBeenCalled()
    expect(hostMock.revealPane).not.toHaveBeenCalled()
  })

  it('explains a source mismatch rather than silently configuring another source', async () => {
    const { notifyBotOpenFailure } = await load()
    hostMock.openModelSettings = vi.fn(() => false)
    notifyBotOpenFailure(Object.assign(new Error('模型不可用'), { code: 'model_unavailable' }), BOT, 'open')
    await lastToast().action?.onClick()

    expect(hostMock.notify).toHaveBeenCalledTimes(2)
    expect(hostMock.revealPane).not.toHaveBeenCalled()
    expect(lastToast().message).toMatch(/connection/i)
    lastToast().action?.onClick()
    expect(hostMock.navigate).toHaveBeenCalledWith('/settings?tab=gateway')
  })

  it('does not retarget a model recovery when the failed Bot has no captured source', async () => {
    const { notifyBotOpenFailure } = await load()
    hostMock.openModelSettings = vi.fn(() => true)
    notifyBotOpenFailure(Object.assign(new Error('模型不可用'), { code: 'model_unavailable' }), { name: 'ops' }, 'open')
    await lastToast().action?.onClick()

    expect(hostMock.openModelSettings).not.toHaveBeenCalled()
    expect(hostMock.notify).toHaveBeenCalledTimes(2)
    expect(lastToast().message).toMatch(/connection/i)
  })

  it('needs-update: names the connection, keeps the raw RPC text in detail, offers Gateways', async () => {
    const { notifyBotOpenFailure } = await load()
    const raw = 'RPC -32601: method not found: bots.canonical'

    notifyBotOpenFailure(new Error(raw), BOT, 'open')

    const toast = lastToast()
    expect(toast.kind).toBe('error')
    expect(toast.message).toContain('Studio Mac')
    expect(toast.message).not.toContain(raw)
    expect(toast.detail).toBe(raw)
    expect(`${toast.title} ${toast.message}`).not.toMatch(/gateway|backend|worker/i)
    expect(hostMock.notifyError).not.toHaveBeenCalled()

    toast.action?.onClick()
    expect(hostMock.navigate).toHaveBeenCalledWith('/settings?tab=gateway')
  })

  it('unreachable: plain-words title and next step; the connection error is detail only', async () => {
    const { notifyBotOpenFailure } = await load()
    const raw = 'WebSocket connect ECONNREFUSED 10.0.0.7:8642'

    notifyBotOpenFailure(new Error(raw), BOT, 'reach')

    const toast = lastToast()
    expect(toast.kind).toBe('error')
    expect(toast.message).not.toContain(raw)
    expect(toast.detail).toBe(raw)
    expect(`${toast.title} ${toast.message}`).not.toMatch(/gateway|backend|worker/i)
    toast.action?.onClick()
    expect(hostMock.navigate).toHaveBeenCalledWith('/settings?tab=gateway')
    expect(hostMock.notifyError).not.toHaveBeenCalled()
  })

  it('model failures reveal the owning bot editor instead of ambient settings', async () => {
    const { notifyBotOpenFailure } = await load()
    const { $editingBot } = await import('./bot-state')

    notifyBotOpenFailure(new Error('model_unavailable: no usable model configured'), BOT, 'open')

    const toast = lastToast()
    expect(toast.action?.label).toBe('Configure model')
    await toast.action?.onClick()
    expect($editingBot.get()).toBe(BOT)
    expect(hostMock.revealPane).toHaveBeenCalledWith('hermes-bots:pane')
    expect(hostMock.navigate).not.toHaveBeenCalled()
    expect(toast.message).not.toContain('model_unavailable')
    expect(toast.message).not.toContain('introduction')
  })
})
