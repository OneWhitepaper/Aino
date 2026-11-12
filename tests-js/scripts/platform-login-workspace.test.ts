import { EventEmitter } from 'node:events'

import { expect, test, vi } from 'vitest'

import type { ElectronApplication, Page } from './e2e-driver-deps.ts'
import { platformLoginWorkspace } from './platform-account-fixture.ts'

function renderer(accountName?: string) {
  const state = { closed: false, accountName }

  const page = {
    isClosed: (): boolean => state.closed,
    getByRole: (role: string, options: { name: string; exact: boolean }) => ({
      isVisible: async (): Promise<boolean> => role === 'button' && options.exact && options.name === state.accountName,
    }),
  } as unknown as Page

  return { page, state }
}

test('historical native login keeps the authenticated original renderer and removes its listener', async (): Promise<void> => {
  const events = new EventEmitter()
  const login = renderer()
  const submit = vi.fn(async () => { login.state.accountName = 'My account · Native member' })

  const workspace = await platformLoginWorkspace(events as unknown as ElectronApplication, login.page, submit)

  expect(workspace).toBe(login.page)
  expect(submit).toHaveBeenCalledOnce()
  expect(events.listenerCount('window')).toBe(0)
})

test('isolated native login returns its authenticated replacement only after the original closes', async (): Promise<void> => {
  const events = new EventEmitter()
  const login = renderer()
  const unrelated = renderer('My account · Another member')
  const account = renderer('My account · Native member')

  const workspace = await platformLoginWorkspace(events as unknown as ElectronApplication, login.page, async () => {
    events.emit('window', unrelated.page)
    events.emit('window', account.page)
    login.state.closed = true
  })

  expect(workspace).toBe(account.page)
  expect(login.state.closed).toBe(true)
  expect(events.listenerCount('window')).toBe(0)
})

test('a window event without the submitted account cannot pass native login', async (): Promise<void> => {
  const events = new EventEmitter()
  const login = renderer()
  const unrelated = renderer('My account · Another member')

  await expect(platformLoginWorkspace(events as unknown as ElectronApplication, login.page, async () => {
    events.emit('window', unrelated.page)
  }, 2_000)).rejects.toThrow('did not reach an authenticated workspace')
  expect(events.listenerCount('window')).toBe(0)
})

test('a replacement cannot pass while its retired login renderer is still open', async (): Promise<void> => {
  const events = new EventEmitter()
  const login = renderer()
  const account = renderer('My account · Native member')

  await expect(platformLoginWorkspace(events as unknown as ElectronApplication, login.page, async () => {
    events.emit('window', account.page)
  }, 2_000)).rejects.toThrow()
  expect(events.listenerCount('window')).toBe(0)
})
