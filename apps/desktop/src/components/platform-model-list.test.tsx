import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { PlatformModelList } from './platform-model-list'

beforeEach(() => {
  stubResizeObserver()
  stubMenuDomApis()
})
afterEach(() => {
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.unstubAllGlobals()
})

function LocationProbe() {
  const location = useLocation()

  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>
}

function installPlatform(models: () => Promise<ReturnType<typeof platformModel>[]>, signedIn = true) {
  const snapshot = signedIn
    ? platformSnapshot()
    : {
        revision: 2,
        phase: 'signed_out' as const,
        account: null,
        mode: 'development' as const,
        remember_state: 'none' as const,
        error: null
      }

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: models }
    }
  })

  return platformAccountActions(window.hermesDesktop.platformAccount).refresh()
}

it('uses catalog labels, searches and blocks unavailable models while retaining selection', async () => {
  const snapshot = platformSnapshot()
  const account = { status: async () => snapshot, capabilities: async () => ({}), onChanged: () => () => {} }
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: account,
      platformModels: {
        list: async () => [
          platformModel(),
          { ...platformModel('blocked'), display_name: 'Unavailable Fixture', state: 'quota_exhausted' }
        ]
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  const select = vi.fn().mockResolvedValue(true)
  render(<PlatformModelList managedCapability="supported" onSelect={select} selectedId="catalog-a" />)
  await screen.findByText('Fixture Model')
  expect(screen.getByRole('option', { name: /Unavailable Fixture/ }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Fixture Model' } })
  await waitFor(() => expect(screen.queryByText('Unavailable Fixture')).toBeNull())
  fireEvent.click(screen.getByText('Fixture Model'))
  await waitFor(() =>
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'catalog-a', model: 'wire-model' }))
  )
})

it('fails closed when route capability is unknown', async () => {
  const snapshot = platformSnapshot()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  const select = vi.fn()
  render(<PlatformModelList managedCapability="unknown" onSelect={select} />)

  expect((await screen.findByRole('status')).textContent).toContain('does not support Aino models')
  expect(screen.queryByRole('option', { name: /Fixture Model/ })).toBeNull()
  expect(select).not.toHaveBeenCalled()
})

it('fails closed when a compatibility caller omits route capability', async () => {
  const snapshot = platformSnapshot()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()] }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  const select = vi.fn()
  const compatibilityProps = { managedCapability: undefined as never, onSelect: select }
  render(<PlatformModelList {...compatibilityProps} />)

  expect((await screen.findByRole('status')).textContent).toContain('does not support Aino models')
  expect(screen.queryByRole('option', { name: /Fixture Model/ })).toBeNull()
})

it('routes a signed-out account to My Account', async () => {
  await installPlatform(async () => [], false)

  render(
    <MemoryRouter initialEntries={['/chat']}>
      <PlatformModelList managedCapability="supported" onChooseCustom={() => undefined} onSelect={() => undefined} />
      <LocationProbe />
    </MemoryRouter>
  )

  fireEvent.click(await screen.findByRole('button', { name: 'My Account' }))

  expect(screen.getByLabelText('location').textContent).toBe('/settings?tab=account')
})

it('offers the existing custom-model picker when the catalog is empty', async () => {
  await installPlatform(async () => [])
  const chooseCustom = vi.fn()

  render(<PlatformModelList managedCapability="supported" onChooseCustom={chooseCustom} onSelect={() => undefined} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Choose custom model' }))

  expect(chooseCustom).toHaveBeenCalledOnce()
})

it('retries a failed catalog request without leaving the picker', async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([platformModel()])
  await installPlatform(list)

  render(<PlatformModelList managedCapability="supported" onSelect={() => undefined} />)

  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByText('Fixture Model')).toBeTruthy()
  expect(list).toHaveBeenCalledTimes(2)
})

it.each([
  ['insufficient_balance', 'Balance Fixture'],
  ['quota_exhausted', 'Quota Fixture']
] as const)('opens My Account and preserves a custom-model exit for %s', async (state, displayName) => {
  await installPlatform(async () => [{ ...platformModel(state), display_name: displayName, state }])
  const chooseCustom = vi.fn()

  render(
    <MemoryRouter initialEntries={['/chat']}>
      <PlatformModelList managedCapability="supported" onChooseCustom={chooseCustom} onSelect={() => undefined} />
      <LocationProbe />
    </MemoryRouter>
  )

  const recovery = await screen.findByRole('group', { name: `${displayName} recovery` })
  fireEvent.click(recovery.querySelector<HTMLButtonElement>('button[data-action="account"]')!)
  expect(screen.getByLabelText('location').textContent).toBe('/settings?tab=account')

  fireEvent.click(recovery.querySelector<HTMLButtonElement>('button[data-action="custom"]')!)
  expect(chooseCustom).toHaveBeenCalledOnce()
})

it('offers custom models for an unavailable catalog row', async () => {
  await installPlatform(async () => [
    { ...platformModel('unavailable'), display_name: 'Unavailable Fixture', state: 'unavailable' }
  ])
  const chooseCustom = vi.fn()

  render(<PlatformModelList managedCapability="supported" onChooseCustom={chooseCustom} onSelect={() => undefined} />)

  const recovery = await screen.findByRole('group', { name: 'Unavailable Fixture recovery' })
  fireEvent.click(recovery.querySelector<HTMLButtonElement>('button[data-action="custom"]')!)

  expect(chooseCustom).toHaveBeenCalledOnce()
})

it('offers custom models when the connection cannot bind Aino models', async () => {
  await installPlatform(async () => [platformModel()])
  const chooseCustom = vi.fn()

  render(<PlatformModelList managedCapability="unsupported" onChooseCustom={chooseCustom} onSelect={() => undefined} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Choose custom model' }))

  expect(chooseCustom).toHaveBeenCalledOnce()
})
