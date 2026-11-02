import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Globe, Users } from '@/lib/icons'
import { $commandPaletteOpen, $commandPalettePage, $commandPaletteSeed } from '@/store/command-palette'

import type { OverlayNavGroup } from '../overlays/overlay-split-layout'

import { SectionHeading, SettingsContent } from './primitives'
import { SettingsShell } from './settings-shell'

afterEach(cleanup)

describe('Settings page composition', () => {
  it('keeps back, nested route selection and system actions attached to the existing handlers', () => {
    const close = vi.fn()
    const selectChild = vi.fn()
    const systemAction = vi.fn()

    const groups: OverlayNavGroup[] = [
      {
        active: true,
        children: [{ active: true, icon: Globe, id: 'api-keys', label: 'API keys', onSelect: selectChild }],
        icon: Globe,
        id: 'providers',
        label: 'Model services',
        onSelect: vi.fn()
      }
    ]

    const view = render(
      <SettingsShell groups={groups} onClose={close} toolbar={<button onClick={systemAction}>Gateway status</button>}>
        <SettingsContent>Provider fields</SettingsContent>
      </SettingsShell>
    )

    const nav = within(view.container.querySelector('[data-aino-overlay-nav]') as HTMLElement)

    expect(view.getByRole('heading', { level: 1, name: 'API keys' })).toBeTruthy()
    fireEvent.click(nav.getByRole('button', { name: 'API keys' }))
    expect(selectChild).toHaveBeenCalledOnce()
    expect(nav.queryByRole('button', { name: 'Gateway status' })).toBeNull()
    const toolbar = within(view.container.querySelector('[data-settings-toolbar]') as HTMLElement)
    fireEvent.click(toolbar.getByRole('button', { name: 'Gateway status' }))
    expect(systemAction).toHaveBeenCalledOnce()
    fireEvent.click(view.container.querySelector('[data-settings-header] button')!)
    expect(close).toHaveBeenCalledOnce()
    expect(view.getByText('Provider fields')).toBeTruthy()
  })

  it('renders the page title once without hiding differently named sections or embedded settings headings', () => {
    const view = render(
      <SettingsShell
        groups={[{ active: true, icon: Users, id: 'account', label: 'My account', onSelect: vi.fn() }]}
        onClose={vi.fn()}
        toolbar={null}
      >
        <SettingsContent>
          <SectionHeading icon={Users} page title="My account" />
          <SectionHeading icon={Globe} page title="Devices and security" />
        </SettingsContent>
      </SettingsShell>
    )

    expect(within(view.getByRole('main')).getAllByText('My account')).toHaveLength(1)
    expect(view.getByText('Devices and security')).toBeTruthy()
    view.unmount()

    const embedded = render(
      <SettingsContent bare>
        <SectionHeading icon={Users} page title="My account" />
      </SettingsContent>
    )

    expect(embedded.getByText('My account')).toBeTruthy()
  })
})

it('keeps settings destinations visible in open sections and filters without changing the current page', () => {
  const select = vi.fn()

  const groups: OverlayNavGroup[] = [
    { active: true, icon: Users, id: 'account', label: 'My account', onSelect: vi.fn() },
    { active: false, icon: Globe, id: 'config:appearance', label: 'Appearance', onSelect: vi.fn() },
    { active: false, icon: Globe, id: 'config:model', label: 'Model', onSelect: vi.fn() },
    { active: false, icon: Globe, id: 'providers', label: 'Model services', onSelect: select },
    { active: false, icon: Globe, id: 'config:advanced', label: 'Advanced', onSelect: vi.fn() }
  ]

  const view = render(
    <SettingsShell groups={groups} onClose={vi.fn()} toolbar={null}>
      <SettingsContent>Account details</SettingsContent>
    </SettingsShell>
  )

  expect(view.getByRole('heading', { name: 'Personal & appearance' })).toBeTruthy()
  expect(view.getByRole('heading', { name: 'Conversation & intelligence' })).toBeTruthy()
  expect(view.getByRole('heading', { name: 'Work & connections' })).toBeTruthy()
  expect(view.getByRole('heading', { name: 'Security & system' })).toBeTruthy()
  const nav = within(view.container.querySelector('[data-aino-overlay-nav]') as HTMLElement)
  expect(nav.getAllByRole('button')).toHaveLength(groups.length)
  const search = view.getByRole('searchbox', { name: 'Search settings' })
  fireEvent.change(search, { target: { value: 'api' } })
  expect(nav.getByRole('button', { name: 'Model services' })).toBeTruthy()
  expect(nav.queryByRole('button', { name: 'Appearance' })).toBeNull()
  expect(view.getByRole('heading', { level: 1, name: 'My account' })).toBeTruthy()
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(nav.getByRole('button', { name: 'Model services' }))
  expect(select).toHaveBeenCalledOnce()
  fireEvent.change(search, { target: { value: 'not-an-existing-setting' } })
  expect(nav.queryAllByRole('button')).toHaveLength(0)
  expect(view.getByText('No matching settings')).toBeTruthy()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect((search as HTMLInputElement).value).toBe('')
  expect(nav.getAllByRole('button')).toHaveLength(groups.length)
})

it('reveals a matching plugin grandchild without changing page selection and keeps full search available', () => {
  const open = vi.fn()

  const view = render(
    <SettingsShell
      groups={[
        { active: true, icon: Users, id: 'account', label: 'My account', onSelect: vi.fn() },
        {
          active: false,
          icon: Globe,
          id: 'plugins',
          label: 'Plugins',
          onSelect: vi.fn(),
          children: [
            {
              active: false,
              icon: Globe,
              id: 'hello',
              label: 'Hello runtime',
              onSelect: vi.fn(),
              children: [{ active: false, icon: Globe, id: 'details', label: 'Needle options', onSelect: open }]
            }
          ]
        }
      ]}
      onClose={vi.fn()}
      toolbar={null}
    >
      <SettingsContent>Account details</SettingsContent>
    </SettingsShell>
  )

  const search = view.getByRole('searchbox', { name: 'Search settings' })
  fireEvent.change(search, { target: { value: 'Needle' } })
  expect(view.getByRole('heading', { level: 1, name: 'My account' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Needle options' }))
  expect(open).toHaveBeenCalledOnce()
  expect(view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(0)
  fireEvent.keyDown(search, { key: 'Enter' })
  expect($commandPaletteOpen.get()).toBe(true)
  expect($commandPalettePage.get()).toBe('settings')
  expect($commandPaletteSeed.get()).toBe('Needle')
  $commandPaletteOpen.set(false)
  $commandPalettePage.set(null)
  $commandPaletteSeed.set(null)
})
