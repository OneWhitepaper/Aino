import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getElevenLabsVoices, getHermesConfigSchema, setApiRequestConnection, setApiRequestProfile } from '@/hermes'

const api = vi.fn(async (_request: { connectionId?: string; path: string; profile?: string }) => ({}))

beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  setApiRequestConnection('active-gateway')
  setApiRequestProfile('active-profile')
})

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  api.mockClear()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('voice configuration resource ownership', () => {
  it.each([
    ['/api/config/schema', getHermesConfigSchema],
    ['/api/audio/elevenlabs/voices', getElevenLabsVoices]
  ] as const)('reads %s from the explicitly selected connection and profile', async (path, read) => {
    await read({ connectionId: 'other-gateway', profile: 'voice-bot' })

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'other-gateway', path, profile: 'voice-bot' })
    )
  })

  it('retains string and ambient profile compatibility', async () => {
    await getElevenLabsVoices('legacy-profile')
    await getHermesConfigSchema()

    expect(api.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ connectionId: 'active-gateway', profile: 'legacy-profile' })
    )
    expect(api.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ connectionId: 'active-gateway', profile: 'active-profile' })
    )
  })
})
