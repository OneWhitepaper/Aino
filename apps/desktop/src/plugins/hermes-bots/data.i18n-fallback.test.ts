import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterRow } from './types'

const { hostMock, pluginCtx } = vi.hoisted(() => ({
  hostMock: {
    notify: vi.fn(),
    newChat: undefined as unknown,
    request: vi.fn(),
    requestProfile: vi.fn(),
    state: { connectionId: { get: () => 'local' }, profile: { get: () => 'default' } }
  },
  pluginCtx: { current: null as null | { i18n?: { t: (key: string, ...args: unknown[]) => string } } }
}))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    host: hostMock,
    queryClient: { invalidateQueries: vi.fn() },
    translateNow: (key: string) => key,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({
  ID: 'hermes-bots',
  getPluginCtx: () => pluginCtx.current,
  pluginText: (key: string, fallback: string, ...args: unknown[]) => {
    const translated = pluginCtx.current?.i18n?.t(key, ...args)

    return translated && translated !== key ? translated : fallback
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  pluginCtx.current = { i18n: { t: (key: string) => key } }
  hostMock.newChat = undefined
})

describe('Bot Mode non-reactive labels', () => {
  it('keeps English source-status labels when the translator returns raw keys', async () => {
    const { botSourceStatus } = await import('./data')

    const cases = [
      [{ sourceMissing: true }, 'Gateway removed'],
      [{ sourceError: 'connect-on-demand' }, 'On demand'],
      [{ sourceError: 'connection refused' }, 'Unavailable'],
      [{ sourceReachable: true }, 'Ready'],
      [{}, 'Status unknown']
    ] as const

    for (const [fields, expected] of cases) {
      expect(botSourceStatus(fields).label).toBe(expected)
    }
  })

  it('keeps the new-chat compatibility notice readable when the translator returns a raw key', async () => {
    const { newBotChat } = await import('./data')

    newBotChat({ name: 'researcher' } as RosterRow)

    expect(hostMock.notify).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Update Aino to open another Bot chat.'
    })
  })
})
