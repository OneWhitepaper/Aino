import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import { I18nProvider, translateNow } from '@/i18n'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { readPlatformDefault } from '@/store/platform-models'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { PlatformModelSettings } from './platform-model-settings'

stubResizeObserver()
stubMenuDomApis()

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  localStorage.clear()
  clearGatewayManagedCapabilities()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function installCatalog() {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [platformModel('chosen'), { ...platformModel('other'), display_name: 'Other model' }],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  setApiRequestConnection('remote-a')
  recordGatewayReadyCapability(
    { connectionId: 'remote-a', profile: 'work' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
}

it('stages a model only on confirmation and never saves a second default', async () => {
  await installCatalog()
  const onSelect = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings onSelect={onSelect} scopeProfile="work" selectedId="chosen" />
    </I18nProvider>
  )
  expect(screen.queryByRole('option')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Choose an Aino built-in model' }))
  fireEvent.click(await screen.findByRole('option', { name: /Other model/ }))
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Choose an Aino built-in model' }))
  fireEvent.click(await screen.findByRole('option', { name: /Other model/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }))
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'other' })))
  expect(readPlatformDefault('user-a', { connectionId: 'remote-a', profile: 'work' }, 'development')).toBeNull()
})

it('recognizes retained device access without offering management reauthorization while offline', async () => {
  await installCatalog()
  window.hermesDesktop.platformAccount.status = async () => ({
    ...platformSnapshot(),
    phase: 'offline',
    model_identity_ready: true
  })
  window.hermesDesktop.platformModels.reauthorize = vi.fn()
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings onSelect={() => {}} scopeProfile="work" selectedId="chosen" />
    </I18nProvider>
  )

  expect(await screen.findByText(translateNow('settings.model.defaultMain.ainoConnected'))).toBeTruthy()
  expect(screen.queryByText('Sign in to Aino before using this model')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reauthorize this device' })).toBeNull()
})

it('gates the picker using the inspected profile rather than another supported profile', async () => {
  await installCatalog()
  const onSelect = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings onSelect={onSelect} scopeProfile="unsupported" selectedId="chosen" />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Choose an Aino built-in model' }))
  expect((await screen.findByRole('status')).textContent).toMatch(/does not support/i)
  expect((screen.getByRole('button', { name: 'Confirm choice' }) as HTMLButtonElement).disabled).toBe(true)
  expect(onSelect).not.toHaveBeenCalled()
})

it('reauthorizes the native device only after an explicit confirmation with its account revision', async () => {
  await installCatalog()
  const reauthorize = vi.fn(async () => undefined)
  window.hermesDesktop.platformModels.reauthorize = reauthorize
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings onSelect={() => {}} scopeProfile="work" selectedId="chosen" />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Reauthorize this device' }))
  expect(reauthorize).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog')
  fireEvent.click(
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Reauthorize this device')!
  )
  await waitFor(() => expect(reauthorize).toHaveBeenCalledWith(platformSnapshot().revision))
})

it('keeps reauthorization failures visible across account updates and retries with the current revision', async () => {
  await installCatalog()
  const first = deferred()
  const retry = deferred()
  const reauthorize = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
  window.hermesDesktop.platformModels.reauthorize = reauthorize
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings onSelect={() => {}} scopeProfile="work" selectedId="chosen" />
    </I18nProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Reauthorize this device' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reauthorize this device' }))
  expect(reauthorize).toHaveBeenCalledWith(1)

  act(() => {
    platformAccountActions(window.hermesDesktop.platformAccount).snapshot.set({
      ...platformSnapshot('user-a', 2),
      model_identity_ready: false
    })
  })
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Loading…' }).hasAttribute('disabled')).toBe(
    true
  )

  await act(async () => {
    first.reject(Object.assign(new Error('raw server response'), { code: 'RECENT_AUTH_REQUIRED' }))
  })
  expect(within(screen.getByRole('dialog')).getByText('Sign in again to continue.')).toBeTruthy()
  expect(screen.queryByText('raw server response')).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reauthorize this device' }))
  expect(reauthorize).toHaveBeenLastCalledWith(2)
  await act(async () => retry.resolve())
})

it.each([
  { change: 'account', outcome: 'failure' },
  { change: 'route', outcome: 'success' }
] as const)(
  'isolates a new device confirmation from the old $outcome after its $change changes',
  async ({ change, outcome }) => {
    await installCatalog()
    const request = deferred()
    const reauthorize = vi.fn(() => request.promise)
    window.hermesDesktop.platformModels.reauthorize = reauthorize

    const settings = (scopeProfile: string) => (
      <I18nProvider configClient={null} initialLocale="en">
        <PlatformModelSettings onSelect={() => {}} scopeProfile={scopeProfile} selectedId="chosen" />
      </I18nProvider>
    )

    const view = render(settings('work'))
    fireEvent.click(await screen.findByRole('button', { name: 'Reauthorize this device' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reauthorize this device' }))

    if (change === 'account') {
      act(() =>
        platformAccountActions(window.hermesDesktop.platformAccount).snapshot.set(platformSnapshot('user-b', 2))
      )
    } else {
      view.rerender(settings('other'))
    }

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reauthorize this device' }))

    if (outcome === 'failure') {
      await act(async () =>
        request.reject(Object.assign(new Error('expired request'), { code: 'RECENT_AUTH_REQUIRED' }))
      )
    } else {
      vi.useFakeTimers()
      await act(async () => {
        request.resolve()
        await request.promise
        await vi.advanceTimersByTimeAsync(700)
      })
    }

    expect(within(screen.getByRole('dialog')).queryByText('Sign in again to continue.')).toBeNull()
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('button', { name: 'Reauthorize this device' })
        .hasAttribute('disabled')
    ).toBe(false)
    expect(reauthorize).toHaveBeenCalledTimes(1)
  }
)
