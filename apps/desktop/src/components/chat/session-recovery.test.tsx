import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $notificationEpoch } from '@/store/notifications'
import { $deferredSessionSignIns, captureSessionRecovery, deferSessionSignIn } from '@/store/session-recovery'
import { $sessionStates } from '@/store/session-states'
import { platformSnapshot } from '@/test/platform-model'

import { SessionModelRecovery } from './session-model-recovery'
import { SessionRecoveryStatus } from './session-recovery-status'
import { SessionSignInRecovery } from './session-sign-in-recovery'

const mocks = vi.hoisted(() => ({
  owner: { connectionId: 'source-a', profile: 'default' },
  select: vi.fn(),
  signIn: vi.fn(),
  picker: null as null | {
    onSelect: (selection: { provider: string; model: string }) => Promise<boolean>
    request: (method: string) => Promise<unknown>
  }
}))

const account = atom(platformSnapshot())
vi.mock('@/api/platform', () => ({ platformAccountActions: () => ({ snapshot: account }) }))
vi.mock('@/store/platform-model-capability', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPlatformSignInRecovery: () => mocks.signIn
}))
vi.mock('@/store/session-states', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  knownOwnerForSession: () => mocks.owner,
  sessionTileDelegate: () => ({ switchSessionModel: mocks.select })
}))
vi.mock('@/components/model-picker', () => ({
  ModelPickerDialog: (props: typeof mocks.picker) => {
    mocks.picker = props

    return <div role="dialog" />
  }
}))
vi.mock('@/lib/session-model-switch', () => ({
  switchSessionModel: (options: { selection: { sessionId: string; model: string; provider: string } }) =>
    mocks.select(options.selection.sessionId, options.selection.model, options.selection.provider)
}))

beforeEach(() => {
  account.set(platformSnapshot())
  window.hermesDesktop = { platformAccount: {} } as never
  mocks.owner = { connectionId: 'source-a', profile: 'default' }
  mocks.select.mockReset().mockResolvedValue(true)
  mocks.signIn.mockReset().mockResolvedValue(undefined)
  mocks.picker = null
  $deferredSessionSignIns.set({})
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  $deferredSessionSignIns.set({})
})

it('targets the captured session and rejects a later account or source without changing another model', async () => {
  const runtime = atom<string | null>('runtime-a')
  const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: runtime }
  render(
    <SessionViewProvider value={view}>
      <SessionModelRecovery className="" label="Choose model" />
    </SessionViewProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose model' }))
  await mocks.picker!.onSelect({ model: 'DeepSeek', provider: 'aino' })
  expect(mocks.select).toHaveBeenCalledWith('runtime-a', 'DeepSeek', 'aino')
  account.set(platformSnapshot('other-account', 2))
  await expect(mocks.picker!.onSelect({ model: 'Other', provider: 'aino' })).rejects.toThrow(
    /another account or connection/
  )
  expect(mocks.select).toHaveBeenCalledTimes(1)
})

it('keeps a deferred recovery with its own draft and retires it across account/source epochs without replay', async () => {
  const recover = vi.fn().mockResolvedValue(undefined)
  deferSessionSignIn({ ...captureSessionRecovery('runtime-a'), recover })
  const view = render(<SessionRecoveryStatus runtimeId="runtime-b" />)
  expect(screen.queryByRole('button')).toBeNull()
  view.rerender(<SessionRecoveryStatus runtimeId="runtime-a" />)
  expect(screen.getByText('Sign-in expired. Your draft is kept.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
  await act(async () => {})
  expect(recover).toHaveBeenCalledOnce()
  expect(mocks.select).not.toHaveBeenCalled()
  act(() => account.set(platformSnapshot('other-account', 2)))
  expect(screen.queryByRole('button')).toBeNull()
  act(() => $notificationEpoch.set($notificationEpoch.get() + 1))
  expect($deferredSessionSignIns.get()).toEqual({})
})

it('does not authorize the old recovery when the same-named profile moves to another source', () => {
  const target = captureSessionRecovery('runtime-a')
  expect(target.isCurrent()).toBe(true)
  mocks.owner = { connectionId: 'source-b', profile: 'default' }
  expect(target.isCurrent()).toBe(false)
})

it('cannot recapture another account’s existing Aino conversation as the newly signed-in account', () => {
  const before = $sessionStates.get()
  $sessionStates.set({
    ...before,
    old: {
      ...createClientSessionState('stored-old'),
      platformModel: { modelId: 'aino-model', ownerUserId: 'previous-account', status: 'ready' }
    }
  })

  try {
    expect(captureSessionRecovery('old').isCurrent()).toBe(false)
  } finally {
    $sessionStates.set(before)
  }
})

it('defers sign-in into this chat’s input status without losing or submitting its draft', async () => {
  const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: atom<string | null>('expired-session') }
  render(
    <SessionViewProvider value={view}>
      <textarea aria-label="Draft" defaultValue="My unfinished message" />
      <SessionSignInRecovery />
      <SessionRecoveryStatus runtimeId="expired-session" />
    </SessionViewProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Later' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('Sign-in expired. Your draft is kept.')
  expect((screen.getByRole('textbox', { name: 'Draft' }) as HTMLTextAreaElement).value).toBe('My unfinished message')
  expect(mocks.signIn).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
  await act(async () => {})
  expect(mocks.signIn).toHaveBeenCalledOnce()
  expect(mocks.select).not.toHaveBeenCalled()
})
