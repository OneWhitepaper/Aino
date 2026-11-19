import { JsonRpcGatewayError } from '@hermes/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestGatewayForAgent = vi.fn()

vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: (...args: unknown[]) => requestGatewayForAgent(...args)
}))

import { createGatewaySession } from './session-create-request'

// Verbatim admission rejections from older backends (tui_gateway/contracts/registry.py).
const rejection = (field: string, suffix = '') =>
  new JsonRpcGatewayError(`invalid params for session.create: ${field}: Extra inputs are not permitted${suffix}`, {
    code: 4000
  })

const OUT_OF_SYNC =
  ' — the client and the Hermes backend are out of sync (different versions); run `hermes update` and restart both'

const PRE_122899_REJECTION = rejection('cwd_explicit', OUT_OF_SYNC) // v0.21.4 – v0.21.5 wording
const V0213_REJECTION = rejection('cwd_explicit') // v0.21.3 wording, no out-of-sync suffix

const params = { cols: 96, cwd: '/work/repo', cwd_explicit: true, profile: 'default', source: 'desktop' }
const route = { connectionId: 'cloud', profile: 'default' }

describe('createGatewaySession', () => {
  beforeEach(() => requestGatewayForAgent.mockReset())

  it('resends once without cwd_explicit (cwd kept) when a pre-#122899 backend rejects the flag', async () => {
    const { cwd_explicit: _flag, ...withoutFlag } = params

    requestGatewayForAgent.mockRejectedValueOnce(PRE_122899_REJECTION).mockResolvedValueOnce({ session_id: 's1' })
    await expect(createGatewaySession(route, params, vi.fn())).resolves.toEqual({ session_id: 's1' })
    expect(requestGatewayForAgent).toHaveBeenNthCalledWith(
      2,
      'cloud',
      'default',
      'session.create',
      withoutFlag,
      undefined,
      undefined,
      { spawnPriority: 'foreground' }
    )
    expect(requestGatewayForAgent.mock.calls[0][3]).toEqual(params)

    const requestGateway = vi.fn().mockRejectedValueOnce(V0213_REJECTION).mockResolvedValueOnce({ session_id: 's2' })
    await expect(createGatewaySession(null, params, requestGateway)).resolves.toEqual({ session_id: 's2' })
    expect(requestGateway.mock.calls.map(call => call[1])).toEqual([params, withoutFlag])
  })

  it('drops service_tier (fast kept) for a pre-Ultrafast backend, one rejected field at a time', async () => {
    const tiered = { ...params, fast: true, service_tier: 'ultrafast' }
    const { cwd_explicit: _flag, service_tier: _tier, ...legacy } = tiered

    const requestGateway = vi
      .fn()
      .mockRejectedValueOnce(rejection('service_tier', OUT_OF_SYNC))
      .mockRejectedValueOnce(V0213_REJECTION)
      .mockResolvedValueOnce({ session_id: 's3' })

    await expect(createGatewaySession(null, tiered, requestGateway)).resolves.toEqual({ session_id: 's3' })
    expect(requestGateway.mock.calls.map(call => call[1])).toEqual([tiered, { ...legacy, cwd_explicit: true }, legacy])
  })

  it('never resends on any other failure, even one that mentions the field', async () => {
    const cases: Array<[Error, Record<string, unknown>]> = [
      [new Error('request timed out'), params],
      [new Error('handler error: could not resolve cwd_explicit workspace'), params],
      [rejection('some_newer_field', OUT_OF_SYNC), params],
      // The flag was never sent, so a resend would be identical.
      [PRE_122899_REJECTION, { cwd: '/work/repo' }]
    ]

    for (const [failure, sentParams] of cases) {
      const requestGateway = vi.fn().mockRejectedValue(failure)

      await expect(createGatewaySession(null, sentParams, requestGateway)).rejects.toBe(failure)
      expect(requestGateway).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses Code on an older service without retrying as Work', async () => {
    const requestGateway = vi.fn().mockRejectedValue(rejection('execution_mode'))

    await expect(createGatewaySession(null, { ...params, execution_mode: 'code' }, requestGateway)).rejects.toThrow(
      /does not support Aino Code/
    )
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('requires a Code service to acknowledge the requested mode', async () => {
    for (const info of [undefined, { execution_mode: 'work' }]) {
      const requestGateway = vi.fn().mockResolvedValueOnce({ session_id: 'fresh', info }).mockResolvedValueOnce({})

      await expect(createGatewaySession(null, { ...params, execution_mode: 'code' }, requestGateway)).rejects.toThrow(
        /does not support Aino Code/
      )
      expect(requestGateway.mock.calls).toEqual([
        ['session.create', { ...params, execution_mode: 'code' }],
        ['session.close', { session_id: 'fresh' }]
      ])
    }
  })

  it('cleans up an unacknowledged Code session on its captured owner route', async () => {
    const requestGateway = vi.fn()

    requestGatewayForAgent.mockResolvedValueOnce({ session_id: 'fresh' }).mockResolvedValueOnce({})
    await expect(createGatewaySession(route, { ...params, execution_mode: 'code' }, requestGateway)).rejects.toThrow(
      /does not support Aino Code/
    )
    expect(requestGatewayForAgent).toHaveBeenLastCalledWith(
      'cloud',
      'default',
      'session.close',
      { session_id: 'fresh' },
      undefined,
      undefined,
      { spawnPriority: 'foreground' }
    )
    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('keeps the unsupported-mode error when cleanup fails', async () => {
    const cleanupFailure = new Error('connection closed')
    const requestGateway = vi.fn().mockResolvedValueOnce({ session_id: 'fresh' }).mockRejectedValueOnce(cleanupFailure)

    await expect(
      createGatewaySession(null, { ...params, execution_mode: 'code' }, requestGateway)
    ).rejects.toMatchObject({
      message: expect.stringMatching(/does not support Aino Code/),
      cause: cleanupFailure
    })
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('accepts an acknowledged Code session without closing or recreating it', async () => {
    const created = { session_id: 'code-session', info: { execution_mode: 'code' } }
    const requestGateway = vi.fn().mockResolvedValueOnce(created)

    await expect(createGatewaySession(null, { ...params, execution_mode: 'code' }, requestGateway)).resolves.toEqual(
      created
    )
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('does not drop Code folder consent for a service that rejects cwd_explicit', async () => {
    const requestGateway = vi.fn().mockRejectedValue(V0213_REJECTION)

    await expect(createGatewaySession(null, { ...params, execution_mode: 'code' }, requestGateway)).rejects.toThrow(
      /does not support Aino Code/
    )
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })
})
