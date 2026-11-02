import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { MemoryProviderOAuthStatus } from '@/types/hermes'

import { MemoryConnect } from './connect'

const getStatus = vi.fn()
const startOAuth = vi.fn()

vi.mock('@/hermes', () => ({
  getMemoryProviderOAuthStatus: (...args: unknown[]) => getStatus(...args),
  startMemoryProviderOAuth: (...args: unknown[]) => startOAuth(...args)
}))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

const status = (state: MemoryProviderOAuthStatus['state'] = 'idle'): MemoryProviderOAuthStatus => ({
  state,
  connected: state === 'connected',
  auth: state === 'connected' ? 'oauth' : null,
  detail: ''
})

beforeEach(() => {
  vi.useFakeTimers()
  startOAuth.mockResolvedValue({})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function start() {
  getStatus.mockResolvedValueOnce(status())
  render(<MemoryConnect profile="coder" provider="honcho" />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await act(async () => {})
}

it('ends the connection attempt after the existing deadline even when every poll rejects', async () => {
  await start()
  getStatus.mockRejectedValue(new Error('temporary disconnect'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(121500)
  })
  expect(screen.queryByText(/Waiting for browser/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  const requests = getStatus.mock.calls.length
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4500)
  })
  expect(getStatus).toHaveBeenCalledTimes(requests)
})

it('does not let an in-flight poll publish after the user cancels', async () => {
  await start()
  let finish!: (value: MemoryProviderOAuthStatus) => void
  getStatus.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await act(async () => {
    finish(status('connected'))
  })
  expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  expect(screen.queryByText(/OAuth.*set/)).toBeNull()
})

it('does not start polling after cancellation while opening the browser', async () => {
  let started!: () => void
  startOAuth.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        started = resolve
      })
  )
  await start()
  const requests = getStatus.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await act(async () => {
    started()
    await vi.advanceTimersByTimeAsync(4500)
  })
  expect(getStatus).toHaveBeenCalledTimes(requests)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
})

it('stops polling when the component unmounts and ignores a pending response', async () => {
  await start()
  let finish!: (value: MemoryProviderOAuthStatus) => void
  getStatus.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
  const requests = getStatus.mock.calls.length
  cleanup()
  await act(async () => {
    finish(status('connected'))
    await vi.advanceTimersByTimeAsync(4500)
  })
  expect(getStatus).toHaveBeenCalledTimes(requests)
})

it('allows a transient failed poll to recover before the deadline', async () => {
  await start()
  getStatus.mockRejectedValueOnce(new Error('temporary disconnect')).mockResolvedValueOnce(status('connected'))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
  expect(startOAuth).toHaveBeenCalledWith('honcho', 'coder')
  expect(getStatus).toHaveBeenLastCalledWith('honcho', 'coder')
})
