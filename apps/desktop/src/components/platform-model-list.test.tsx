import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { PlatformModelList, type PlatformModelListProps } from './platform-model-list'

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

it('keeps image-purpose catalog entries out of the default chat picker', async () => {
  const image = {
    ...platformModel('image-only'),
    display_name: 'Image Only Fixture',
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...platformModel().capabilities, image_generation: true }
  }

  await installPlatform(async () => [platformModel(), image])
  render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
  await screen.findByRole('option', { name: /Fixture Model/ })
  expect(screen.queryByText('Image Only Fixture')).toBeNull()
})

it('shows image billing rules when opening details without chat token pricing or capabilities', async () => {
  const image = {
    ...platformModel('image-only'),
    display_name: 'Image Only Fixture',
    purpose: 'image' as const,
    api_mode: 'images_generations' as const,
    capabilities: { ...platformModel().capabilities, image_generation: true },
    pricing: { ...platformModel().pricing, unit: 'billing_rules', input: null, output: null }
  }

  await installPlatform(async () => [image])
  render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} purpose="image" selectedId="image-only" />)
  const summary = await screen.findByText('Price and capabilities')
  fireEvent.click(summary)
  expect(screen.getByText('Billed according to the image generation rules. View usage in My Account.')).toBeTruthy()
  expect(screen.getByText('Image generation')).toBeTruthy()
  expect(screen.getByText('Supported')).toBeTruthy()
  expect(screen.queryByText('Input')).toBeNull()
  expect(screen.queryByText('Output')).toBeNull()
  expect(screen.queryByText('Context window')).toBeNull()
  expect(screen.queryByText('Tools')).toBeNull()
  expect(screen.queryByText(/billing_rules/)).toBeNull()
})

function renderMenu(props: Partial<PlatformModelListProps> = {}) {
  return render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <PlatformModelList managedCapability="supported" onSelect={vi.fn()} presentation="menu" {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

it.each(['picker', 'menu'] as const)(
  'shows the account-effective multiplier in the %s model rows',
  async presentation => {
    const discounted = platformModel()
    discounted.pricing.effective_user_rate = '0.2500'
    discounted.pricing.group_peak = { start: '09:00', end: '18:00', multiplier: '2' }
    const free = platformModel('free')
    free.display_name = 'Free Model'
    free.pricing.effective_user_rate = '0'
    await installPlatform(async () => [discounted, free])

    if (presentation === 'menu') {
      renderMenu()
    } else {
      render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
    }

    const role = presentation === 'menu' ? 'menuitem' : 'option'
    const row = await screen.findByRole(role, { name: /Fixture Model/ })
    expect(within(row).getByText('0.25×')).toBeTruthy()
    expect(within(row).getByLabelText('Account rate: 0.25×')).toBeTruthy()
    expect(within(await screen.findByRole(role, { name: /Free Model/ })).getByText('0×')).toBeTruthy()
  }
)

it('refreshes an expired account multiplier when the picker reopens while keeping a fresh catalog cached', async () => {
  let clock = 100_000
  const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  let rate = '0.5'

  const list = vi.fn(async () => [
    { ...platformModel(), pricing: { ...platformModel().pricing, effective_user_rate: rate } }
  ])

  try {
    await installPlatform(list)
    const first = render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
    await screen.findByText('0.5×')
    first.unmount()
    const fresh = render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
    await screen.findByText('0.5×')
    expect(list).toHaveBeenCalledTimes(1)
    fresh.unmount()

    clock += 30_001
    rate = '1.5'
    render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
    await screen.findByText('1.5×')
    expect(list).toHaveBeenCalledTimes(2)
  } finally {
    now.mockRestore()
  }
})

it('reloads account rates when the identity changes without a revision bump', async () => {
  let rate = '0.5'
  await installPlatform(async () => [
    { ...platformModel(), pricing: { ...platformModel().pricing, effective_user_rate: rate } }
  ])
  render(<PlatformModelList managedCapability="supported" onSelect={vi.fn()} />)
  await screen.findByText('0.5×')
  const account = window.hermesDesktop!.platformAccount
  rate = '2.5'
  account.status = async () => ({ ...platformSnapshot(), mode: 'production' })
  await act(async () => {
    await platformAccountActions(account).refresh()
  })
  await screen.findByText('2.5×')
  expect(screen.queryByText('0.5×')).toBeNull()
})

it('uses the shared search in menu presentation without adding a second search or inline details', async () => {
  await installPlatform(async () => [
    platformModel(),
    { ...platformModel('other'), display_name: 'Other Model', provider_label: 'Other Provider' }
  ])
  renderMenu({ searchValue: 'other provider', selectedId: 'catalog-a' })

  expect(await screen.findByRole('menuitem', { name: /Other Model/ })).toBeTruthy()
  expect(screen.queryByText('Fixture Model')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByText('Price and capabilities')).toBeNull()
})

it('previews a menu model on focus, pointer and details click without selecting or closing', async () => {
  await installPlatform(async () => [platformModel()])
  const select = vi.fn()
  const preview = vi.fn()
  const applied = vi.fn()
  renderMenu({ onSelect: select, onPreview: preview, onApplied: applied })

  const row = await screen.findByRole('menuitem', { name: /Fixture Model/ })
  fireEvent.pointerMove(row, { pointerType: 'mouse' })
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: 'catalog-a' }))
  preview.mockClear()
  fireEvent.focus(row)
  expect(preview).toHaveBeenCalledWith(expect.objectContaining({ id: 'catalog-a' }))
  fireEvent.click(screen.getByRole('button', { name: 'Price and capabilities: Fixture Model' }))
  expect(select).not.toHaveBeenCalled()
  expect(applied).not.toHaveBeenCalled()
  expect(screen.getByRole('menu')).toBeTruthy()
})

it('keeps the menu open until a successful model selection and ignores a failed selection', async () => {
  await installPlatform(async () => [platformModel()])
  const selection = deferred<boolean>()

  const select = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockImplementationOnce(() => selection.promise)

  const applied = vi.fn()
  renderMenu({ onSelect: select, onApplied: applied })

  fireEvent.click(await screen.findByRole('menuitem', { name: /Fixture Model/ }))
  await waitFor(() => expect(select).toHaveBeenCalledTimes(1))
  expect(applied).not.toHaveBeenCalled()
  expect(screen.getByRole('menu')).toBeTruthy()
  await act(async () => undefined)
  fireEvent.click(screen.getByRole('menuitem', { name: /Fixture Model/ }))
  expect(applied).not.toHaveBeenCalled()
  expect(screen.getByRole('menu')).toBeTruthy()
  await act(async () => selection.resolve(true))
  expect(applied).toHaveBeenCalledOnce()
})

it('does not dismiss a later host when an earlier model selection succeeds', async () => {
  await installPlatform(async () => [platformModel()])
  const selection = deferred<boolean>()
  const applied = vi.fn()
  let sameOwner = true
  renderMenu({
    onSelect: () => selection.promise,
    onApplied: applied,
    selectionIsCurrent: () => sameOwner
  })

  fireEvent.click(await screen.findByRole('menuitem', { name: /Fixture Model/ }))
  sameOwner = false
  await act(async () => selection.resolve(true))
  expect(applied).not.toHaveBeenCalled()
})
