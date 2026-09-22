import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import { getGlobalModelInfo } from '@/hermes'
import type * as Hermes from '@/hermes'
import { I18nProvider } from '@/i18n'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { readPlatformDefault } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentModel,
  $currentPlatformOwner,
  $currentProvider,
  $selectedStoredSessionId,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentPlatformOwner,
  setCurrentProvider
} from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { PlatformModelSettings } from './platform-model-settings'

stubResizeObserver()
stubMenuDomApis()

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof Hermes>()),
  getGlobalModelInfo: vi.fn()
}))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'hermesDesktop')
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentModelSource('')
  setCurrentPlatformOwner('')
  $activeGatewayProfile.set('default')
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  localStorage.clear()
  clearGatewayManagedCapabilities()
  vi.restoreAllMocks()
})

it('saves the shown scope and updates only its unsent draft, respecting BYOK defaults', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [platformModel('chosen')],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  setApiRequestConnection('remote-a')
  recordGatewayReadyCapability(
    { connectionId: 'remote-a', profile: 'other' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  recordGatewayReadyCapability(
    { connectionId: 'remote-a', profile: 'work' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  $activeGatewayProfile.set('work')
  setApiRequestProfile('work')
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: '', provider: '' })

  const view = (profile: string) => (
    <I18nProvider configClient={null} initialLocale="en">
      <PlatformModelSettings scopeProfile={profile} />
    </I18nProvider>
  )

  const { rerender } = render(view('other'))
  fireEvent.click(await screen.findByRole('option', { name: /Fixture Model/ }))
  await waitFor(() =>
    expect(readPlatformDefault('user-a', { connectionId: 'remote-a', profile: 'other' }, 'development')).toBe('chosen')
  )
  expect($currentModel.get()).toBe('')
  expect(readPlatformDefault('user-a', { connectionId: 'remote-a', profile: 'work' }, 'development')).toBeNull()
  rerender(view('work'))
  fireEvent.click(await screen.findByRole('option', { name: /Fixture Model/ }))
  await waitFor(() =>
    expect([$currentProvider.get(), $currentModel.get(), $currentPlatformOwner.get()]).toEqual([
      'aino',
      'chosen',
      'user-a'
    ])
  )
  $activeSessionId.set('live')
  setCurrentModel('authoritative-live')
  fireEvent.click(screen.getByRole('option', { name: /Fixture Model/ }))
  await act(async () => {})
  expect($currentModel.get()).toBe('authoritative-live')
  $activeSessionId.set(null)
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'byok-default', provider: 'custom:mine' })
  fireEvent.click(screen.getByRole('option', { name: /Fixture Model/ }))
  await waitFor(() =>
    expect([$currentProvider.get(), $currentModel.get(), $currentPlatformOwner.get()]).toEqual([
      'custom:mine',
      'byok-default',
      ''
    ])
  )
})

it('does not publish a delayed saved default into a different foreground connection', async () => {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => platformSnapshot(),
        capabilities: async () => ({}),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [platformModel('chosen')],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  setApiRequestConnection('source-a')
  recordGatewayReadyCapability(
    { connectionId: 'source-a', profile: 'default' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  const info = deferred<{ model: string; provider: string }>()
  vi.mocked(getGlobalModelInfo).mockReturnValue(info.promise)
  render(<PlatformModelSettings scopeProfile="default" />)
  fireEvent.click(await screen.findByRole('option', { name: /Fixture Model/ }))
  await waitFor(() =>
    expect(getGlobalModelInfo).toHaveBeenCalledWith({
      connectionId: 'source-a',
      priority: 'foreground',
      profile: 'default'
    })
  )
  setApiRequestConnection('source-b')
  setCurrentProvider('custom:foreign')
  setCurrentModel('foreign')
  await act(async () => info.resolve({ model: '', provider: '' }))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['custom:foreign', 'foreign'])
  expect(readPlatformDefault('user-a', { connectionId: 'source-a', profile: 'default' }, 'development')).toBe('chosen')
  expect(readPlatformDefault('user-a', { connectionId: 'source-b', profile: 'default' }, 'development')).toBeNull()
})
