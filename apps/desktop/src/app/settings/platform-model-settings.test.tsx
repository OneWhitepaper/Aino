import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import { I18nProvider } from '@/i18n'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { readPlatformDefault } from '@/store/platform-models'
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
  fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Reauthorize this device')!)
  await waitFor(() => expect(reauthorize).toHaveBeenCalledWith(platformSnapshot().revision))
})
