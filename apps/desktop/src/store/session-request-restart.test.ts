import { afterEach, expect, it, vi } from 'vitest'

import { beginBackendTransition, endBackendTransition, resetBackendTransitionsForTests } from './backend-transition'
import type * as GatewayModule from './gateway'
import { dialedGatewayModeFor, requestGatewayForAgent, requestGatewayForProfile } from './gateway'
import { $profileRemoteOverrides } from './profile-remote-override'
import { requestForSessionProfile } from './session-request-router'

vi.mock('./gateway', async importOriginal => ({
  ...(await importOriginal<typeof GatewayModule>()),
  dialedGatewayModeFor: vi.fn(() => null),
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => vi.fn())
}))

afterEach(() => {
  resetBackendTransitionsForTests()
  $profileRemoteOverrides.set({})
  vi.resetAllMocks()
})

it.each(['session.resume', 'session.history'])(
  'waits for a planned restart before repeating %s on the captured exact owner',
  async method => {
    const owner = { connectionId: 'local', profile: 'work' }
    const params = { session_id: 'stored-work' }
    const ambient = vi.fn()
    const send = vi.mocked(requestGatewayForAgent)
    send
      .mockRejectedValueOnce(new Error('WebSocket heartbeat acknowledgement timed out'))
      .mockResolvedValue({ ok: true })
    beginBackendTransition('work', 'restarting', { source: 'launcher' })
    let state = 'pending'
    const request = requestForSessionProfile(owner, ambient, method, params)
    void request.then(
      () => {
        state = 'resolved'
      },
      () => {
        state = 'rejected'
      }
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(state).toBe('pending')
    expect(send).toHaveBeenCalledTimes(1)
    endBackendTransition('work', { source: 'launcher' })
    await expect(request).resolves.toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      send.mock.calls.every(
        call => call[0] === 'local' && call[1] === 'work' && call[2] === method && call[3] === params
      )
    ).toBe(true)
    expect(ambient).not.toHaveBeenCalled()
  }
)

it('does not repeat an uncertain unkeyed write or a request on an unrelated remote', async () => {
  const error = new Error('WebSocket heartbeat acknowledgement timed out')
  const send = vi.mocked(requestGatewayForAgent).mockRejectedValue(error)
  beginBackendTransition('work', 'restarting', { source: 'launcher' })
  const ambient = vi.fn()

  await expect(
    requestForSessionProfile({ connectionId: 'local', profile: 'work' }, ambient, 'config.set', { value: 1 })
  ).rejects.toBe(error)
  await expect(
    requestForSessionProfile({ connectionId: 'remote-box', profile: 'work' }, ambient, 'session.resume', {
      session_id: 'remote'
    })
  ).rejects.toBe(error)
  expect(send).toHaveBeenCalledTimes(2)
  expect(ambient).not.toHaveBeenCalled()
  expect(requestGatewayForProfile).not.toHaveBeenCalled()
})

it('recovers a bare local profile without going through the ambient route', async () => {
  const send = vi.mocked(requestGatewayForProfile)
  const ambient = vi.fn()
  send.mockRejectedValueOnce(new Error('connection closed')).mockResolvedValue({ resumed: true })
  beginBackendTransition('work', 'restarting', { source: 'launcher' })
  const pending = requestForSessionProfile('work', ambient, 'session.resume', { session_id: 'stored-work' })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(send).toHaveBeenCalledTimes(1)
  endBackendTransition('work', { source: 'launcher' })
  await expect(pending).resolves.toEqual({ resumed: true })
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls.every(call => call[0] === 'work')).toBe(true)
  expect(ambient).not.toHaveBeenCalled()
})

it('keeps the submission identity when repeating a deduplicated write after a restart', async () => {
  const params = { submission_id: 'same-paid-submission', session_id: 'stored-work', text: 'hello' }
  const send = vi.mocked(requestGatewayForAgent)
  const ambient = vi.fn()
  send.mockRejectedValueOnce(new Error('connection closed')).mockResolvedValue({ status: 'completed' })
  beginBackendTransition('work', 'restarting', { source: 'launcher' })
  const pending = requestForSessionProfile({ connectionId: 'local', profile: 'work' }, ambient, 'prompt.submit', params)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(send).toHaveBeenCalledTimes(1)
  endBackendTransition('work', { source: 'launcher' })
  await expect(pending).resolves.toEqual({ status: 'completed' })
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls.every(call => call[0] === 'local' && call[1] === 'work' && call[3] === params)).toBe(true)
  expect(ambient).not.toHaveBeenCalled()
})

it.each(['starting', 'stopping'] as const)(
  'does not repeat an uncertain write when %s replaces its deduplication authority',
  async kind => {
    const error = new Error('connection closed')
    const send = vi.mocked(requestGatewayForAgent).mockRejectedValueOnce(error).mockResolvedValue({ ok: true })
    const params = { submission_id: 'old-backend-key', session_id: 'stored-work', text: 'hello' }
    beginBackendTransition('work', kind, { source: 'switch' })

    const pending = requestForSessionProfile(
      { connectionId: 'local', profile: 'work' },
      vi.fn(),
      'prompt.submit',
      params
    )

    // Attach rejection handling before ending the transition.
    const observed = pending.then(
      value => value,
      caught => caught
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    endBackendTransition('work', { source: 'switch' })
    expect(await observed).toBe(error)
    expect(send).toHaveBeenCalledTimes(1)
  }
)

it.each(['failed', 'expired', 'aborted'] as const)('never repeats after a %s recovery', async outcome => {
  const error = new Error('connection closed')
  const send = vi.mocked(requestGatewayForAgent).mockRejectedValue(error)
  const controller = new AbortController()
  vi.useFakeTimers()

  try {
    beginBackendTransition('work', 'restarting', { source: 'launcher', maxMs: 100 })

    const pending = requestForSessionProfile(
      { connectionId: 'local', profile: 'work' },
      vi.fn(),
      'session.history',
      { session_id: 'stored-work' },
      undefined,
      controller.signal
    )

    const observed = pending.catch(caught => caught)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(1)

    if (outcome === 'failed') {
      endBackendTransition('work', { source: 'launcher', ok: false })
    }

    if (outcome === 'expired') {
      await vi.advanceTimersByTimeAsync(101)
    }

    if (outcome === 'aborted') {
      controller.abort()
    }

    const caught = await observed

    if (outcome === 'aborted') {
      expect(caught).toMatchObject({ name: 'AbortError' })
    } else {
      expect(caught).toBe(error)
    }

    expect(send).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('does not replay a keyed request if a restart is replaced by a backend switch while waiting', async () => {
  const error = new Error('connection closed')
  const send = vi.mocked(requestGatewayForAgent).mockRejectedValueOnce(error).mockResolvedValue({ ok: true })
  beginBackendTransition('work', 'restarting', { source: 'launcher' })

  const pending = requestForSessionProfile({ connectionId: 'local', profile: 'work' }, vi.fn(), 'prompt.submit', {
    session_id: 'stored-work',
    submission_id: 'same-paid-submission',
    text: 'hello'
  }).catch(caught => caught)

  await new Promise(resolve => setTimeout(resolve, 0))
  beginBackendTransition('work', 'starting', { source: 'switch' })
  endBackendTransition('work', { source: 'switch' })
  expect(await pending).toBe(error)
  expect(send).toHaveBeenCalledTimes(1)
})

it('recovers a legacy plugin launcher even though its loopback transport is described as remote', async () => {
  vi.mocked(dialedGatewayModeFor).mockReturnValue('remote')
  $profileRemoteOverrides.set({
    work: { host: '127.0.0.1:47911', url: 'http://127.0.0.1:47911', launcher: { plugin: 'acme' } }
  })
  const send = vi
    .mocked(requestGatewayForProfile)
    .mockRejectedValueOnce(new Error('connection closed'))
    .mockResolvedValue({ ok: true })
  beginBackendTransition('work', 'restarting', { source: 'launcher' })
  const pending = requestForSessionProfile('work', vi.fn(), 'session.resume', { session_id: 'stored-work' })
  const observed = pending.then(
    value => value,
    error => error
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(send).toHaveBeenCalledTimes(1)
  endBackendTransition('work', { source: 'launcher' })
  expect(await observed).toEqual({ ok: true })
  expect(send).toHaveBeenCalledTimes(2)
})
