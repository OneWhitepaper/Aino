import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateSessionSummary, readSessionSummary } from './session-summary'

const routing = vi.hoisted(() => ({ request: vi.fn(), prepare: vi.fn(), gateway: { get: () => null } }))
vi.mock('@/store/session-request-router', () => ({ requestForSessionProfile: routing.request }))
vi.mock('@/store/gateway', () => ({ $gateway: routing.gateway }))
vi.mock('./platform-session-binding', () => ({ preparePlatformSessionRequest: routing.prepare }))

afterEach(() => {
  vi.resetAllMocks()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('session summary transport', () => {
  it('reads the durable owner but generates through the authenticated runtime after preparing its model binding', async () => {
    const scope = { connectionId: 'remote-owner', profile: 'writer' }
    const api = vi.fn(async () => ({ summary: null, eligible: true, source_revision: 'r1', stale: true }))
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
    const order: string[] = []
    routing.prepare.mockImplementation(async (owner, method, params, request) => {
      expect(owner).toEqual(scope)
      expect(method).toBe('session.summary')
      expect(params.session_id).toBe('runtime-id')
      order.push('prepare')
      await request('session.managed_model_ticket', { session_id: params.session_id })
    })
    routing.request.mockImplementation(async (_owner, _ambient, method) => {
      order.push(method)

      return { summary: null, eligible: true, source_revision: 'r1', stale: false }
    })

    await readSessionSummary('stored-id', scope, 'zh')
    await generateSessionSummary('stored-id', scope, 'zh', { id: 'runtime-id', owner: scope }, true)
    expect(api).toHaveBeenCalledOnce()
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, path: '/api/sessions/stored-id/summary?profile=writer&language=zh' })
    )
    expect(order).toEqual(['prepare', 'session.managed_model_ticket', 'session.summary'])
    expect(routing.request).toHaveBeenLastCalledWith(
      scope,
      expect.any(Function),
      'session.summary',
      { session_id: 'runtime-id', language: 'zh', retry: true },
      120_000
    )
  })

  it('never generates or falls back to REST when the account model binding fails', async () => {
    const api = vi.fn()
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
    routing.prepare.mockRejectedValue(new Error('Account changed'))
    const scope = { connectionId: 'local', profile: 'default' }

    await expect(generateSessionSummary('stored', scope, 'en', { id: 'runtime', owner: scope })).rejects.toThrow(
      'Account changed'
    )
    expect(routing.request).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })
})
