import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from './client'
import { getGlobalModelInfo } from './models'

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each(['local', 'captured-remote'])(
  'reads the captured default owner %s despite a different active connection',
  async connectionId => {
    const api = vi.fn().mockResolvedValue({ model: 'owner-model', provider: 'owner-provider' })
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
    setApiRequestConnection('other-remote')
    setApiRequestProfile('other-profile')

    await expect(getGlobalModelInfo({ connectionId, profile: 'owner-profile' })).resolves.toEqual({
      model: 'owner-model',
      provider: 'owner-provider'
    })
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId,
        profile: 'owner-profile',
        path: '/api/model/info'
      })
    )
  }
)

it('keeps the configured model when the bounded backend probe returns its fallback', async () => {
  vi.useFakeTimers()
  const assignment = { model: 'configured-model', provider: 'custom', effective_context_length: 64_000 }

  const api = vi.fn(
    ({ timeoutMs }: { timeoutMs: number }) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('backend request timed out')), timeoutMs)

        // The backend probe may spend its full five-second budget before returning
        // the configured assignment; delivery still needs a small transport margin.
        setTimeout(() => {
          clearTimeout(timeout)
          resolve(assignment)
        }, 5_100)
      })
  )

  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })

  const result = getGlobalModelInfo().then(
    value => ({ value }),
    error => ({ error })
  )
  await vi.advanceTimersByTimeAsync(5_100)
  await expect(result).resolves.toEqual({ value: assignment })
})
