import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $gatewayRouteRevision } from '@/store/gateway-route-observation'
import { $notificationEpoch } from '@/store/notifications'
import { $sessions } from '@/store/session'
import type { SessionOwnerScope } from '@/store/session-request-router'
import { platformSnapshot } from '@/test/platform-model'

import { SessionConnectionStatus } from './session-connection-status'

const mocks = vi.hoisted(() => ({
  owners: {} as Record<string, SessionOwnerScope>,
  states: {} as Record<string, 'open' | 'closed' | 'connecting' | 'error'>,
  reconnect: vi.fn()
}))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gatewayRouteState: (connectionId: string, profile: string) => ({
    state: mocks.states[`${connectionId}:${profile}`] ?? null
  })
}))
vi.mock('@/store/session-states', async importOriginal => {
  const original = await importOriginal<{ knownOwnerForSession: (runtimeId: string) => SessionOwnerScope }>()

  return {
    ...original,
    knownOwnerForSession: (runtimeId: string) => mocks.owners[runtimeId] ?? original.knownOwnerForSession(runtimeId)
  }
})

const account = atom(platformSnapshot())
vi.mock('@/api/platform', () => ({ platformAccountActions: () => ({ snapshot: account }) }))
vi.mock('@/store/gateway-reconnect', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reconnectGateway: mocks.reconnect
}))

function become(source: string, state: (typeof mocks.states)[string]): void {
  act(() => {
    mocks.states[`${source}:default`] = state
    $gatewayRouteRevision.set($gatewayRouteRevision.get() + 1)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  window.hermesDesktop = { platformAccount: {} } as never
  account.set(platformSnapshot())
  $sessions.set([])
  mocks.owners = {
    'chat-a': { connectionId: 'source-a', profile: 'default' },
    'chat-b': { connectionId: 'source-b', profile: 'default' }
  }
  mocks.states = { 'source-a:default': 'open', 'source-b:default': 'open' }
  mocks.reconnect.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  $sessions.set([])
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('shows only the split owner that actually lost its connection and preserves the draft', () => {
  render(
    <>
      <textarea aria-label="Draft" defaultValue="Keep this exact unsent draft" />
      <SessionConnectionStatus runtimeId="chat-a" />
      <SessionConnectionStatus runtimeId="chat-b" />
      <SessionConnectionStatus runtimeId="unknown-owner" />
    </>
  )
  expect(screen.queryByRole('status')).toBeNull()
  become('source-a', 'closed')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByText(/Connection lost/)).toBeTruthy()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' }).value).toBe('Keep this exact unsent draft')
  become('source-a', 'connecting')
  expect(screen.getByText(/Reconnecting/)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reconnect' }).disabled).toBe(true)
  expect(mocks.reconnect).not.toHaveBeenCalled()
})

it('announces restored only after an observed loss, without claiming verification or resending', () => {
  render(<SessionConnectionStatus runtimeId="chat-a" />)
  expect(screen.queryByText(/Connection restored/)).toBeNull()
  become('source-b', 'closed')
  become('source-b', 'open')
  expect(screen.queryByRole('status')).toBeNull()
  become('source-a', 'closed')
  become('source-a', 'open')
  expect(screen.getByText(/Connection restored/).textContent).toContain('may still need checking; nothing was resent')
  expect(mocks.reconnect).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(8_000))
  expect(screen.queryByRole('status')).toBeNull()
})

it('reconnects the captured owner, guards later account epochs and never adopts another split source', async () => {
  mocks.states['source-a:default'] = 'closed'
  let finish!: () => void
  mocks.reconnect.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      })
  )
  render(<SessionConnectionStatus runtimeId="chat-a" />)
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
  const options = mocks.reconnect.mock.calls[0][0]
  expect(options.target).toMatchObject({ connectionId: 'source-a', profile: 'default' })
  expect(options.target.isCurrent()).toBe(true)
  expect(screen.getByText(/Reconnecting/)).toBeTruthy()
  act(() => $notificationEpoch.set($notificationEpoch.get() + 1))
  expect(options.target.isCurrent()).toBe(false)
  await act(async () => finish())
  expect(mocks.reconnect).toHaveBeenCalledOnce()
})

it('refreshes presentation after a same-account snapshot revision while preserving old operation fences', () => {
  render(<SessionConnectionStatus runtimeId="chat-a" />)
  act(() => account.set(platformSnapshot('user-a', 2)))
  become('source-a', 'closed')
  expect(screen.getByText(/Connection lost/)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reconnect' }).disabled).toBe(false)
})

it('tracks an owner loaded or changed only through session rows, without borrowing the foreground source', () => {
  render(<SessionConnectionStatus runtimeId="row-chat" />)
  expect(screen.queryByRole('status')).toBeNull()
  become('source-a', 'closed')
  act(() => $sessions.set([{ id: 'row-chat', connection_id: 'source-a', profile: 'default' }] as never))
  expect(screen.getByText(/Connection lost/)).toBeTruthy()
  act(() => $sessions.set([{ id: 'row-chat', connection_id: 'source-b', profile: 'default' }] as never))
  expect(screen.queryByRole('status')).toBeNull()
})
