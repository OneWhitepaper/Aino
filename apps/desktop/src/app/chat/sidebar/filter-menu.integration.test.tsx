// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { en } from '@/i18n/en'
import { $interfaceMode } from '@/store/interface-mode'
import { $sidebarListGroupIds, $sidebarWorkspaceNodeOpen, setSidebarGrouping } from '@/store/layout'
import type * as Notifications from '@/store/notifications'
import { $activeGatewayProfile, $profiles, $showAllProfiles } from '@/store/profile'
import { $profileRailVisible } from '@/store/profile-rail-prefs'
import { $projectTree } from '@/store/projects'
import { $connection } from '@/store/session'

import { SidebarFilterMenu } from './filter-menu'

const importFlow = vi.hoisted(() => vi.fn<() => Promise<string | null>>())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@/store/profile-share', () => ({ runImportProfileFlow: importFlow, runExportProfileFlow: vi.fn() }))
vi.mock('@/store/notifications', async importOriginal => ({
  ...(await importOriginal<typeof Notifications>()),
  notifyError
}))

function Route() {
  return <output aria-label="Current route">{useLocation().pathname}</output>
}

function renderMenu() {
  return render(
    <MemoryRouter>
      <SidebarFilterMenu />
      <Route />
    </MemoryRouter>
  )
}

beforeEach(() => {
  setSidebarGrouping('date')
  $sidebarWorkspaceNodeOpen.set({})
  $sidebarListGroupIds.set(['list:today'])
  $projectTree.set([{ id: 'p_app', label: 'App', path: '/work/app', repos: [], sessionCount: 0 }])
  importFlow.mockReset()
  notifyError.mockReset()
  $connection.set(null)
})
afterEach(() => {
  cleanup()
  $projectTree.set([])
  $sidebarListGroupIds.set([])
  $sidebarWorkspaceNodeOpen.set({})
  $profiles.set([])
  $showAllProfiles.set(false)
  $activeGatewayProfile.set('default')
  $connection.set(null)
})

it('folds both simultaneously visible project and recent groups without touching pins', async () => {
  renderMenu()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Filters' }), { button: 0, ctrlKey: false })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Collapse all' }))
  expect($sidebarWorkspaceNodeOpen.get()).toEqual({ p_app: false, 'list:today': false })
})

it('keeps advanced workspace management out of the ordinary conversation filter menu', () => {
  renderMenu()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Filters' }), { button: 0, ctrlKey: false })
  expect(screen.queryByRole('menuitem', { name: 'Profile' })).toBeNull()
})

it('opens Bot management without toggling the retired profile rail', () => {
  $interfaceMode.set('advanced')
  const railVisible = $profileRailVisible.get()
  $activeGatewayProfile.set('research')
  renderMenu()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Filters' }), { button: 0, ctrlKey: false })
  fireEvent.click(screen.getByRole('menuitem', { name: en.keybinds.actions['view.toggleProfileRail'] }))
  expect(screen.getByLabelText('Current route').textContent).toBe('/profiles')
  expect($profileRailVisible.get()).toBe(railVisible)
  expect($activeGatewayProfile.get()).toBe('research')
})

it.each(['imported', null])('preserves the ordinary owner when the Bot archive result is %s', async result => {
  $showAllProfiles.set(true)
  $profiles.set([{ name: 'default' }, { name: 'research' }] as never)
  $activeGatewayProfile.set('research')
  importFlow.mockResolvedValue(result)
  renderMenu()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Filters' }), { key: 'Enter' })
  fireEvent.keyDown(screen.getByRole('menuitem', { name: en.ui.actions.profile }), { key: 'ArrowRight' })
  fireEvent.click(screen.getByRole('menuitem', { name: en.profiles.importProfile }))
  await waitFor(() => expect(importFlow).toHaveBeenCalledWith({ management: true, scope: { connectionId: 'local' } }))
  await waitFor(() => expect(screen.getByLabelText('Current route').textContent).toBe(result ? '/profiles' : '/'))
  expect($activeGatewayProfile.get()).toBe('research')
})

it('rejects remote archive import through the shared SDK before opening a native file flow', async () => {
  $showAllProfiles.set(true)
  $profiles.set([{ name: 'default' }, { name: 'research' }] as never)
  $activeGatewayProfile.set('research')
  $connection.set({ mode: 'remote', connectionId: 'studio' } as never)
  renderMenu()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Filters' }), { key: 'Enter' })
  fireEvent.keyDown(screen.getByRole('menuitem', { name: en.ui.actions.profile }), { key: 'ArrowRight' })
  fireEvent.click(screen.getByRole('menuitem', { name: en.profiles.importProfile }))
  await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.any(Error), en.profiles.failedImport))
  expect(importFlow).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Current route').textContent).toBe('/')
  expect($activeGatewayProfile.get()).toBe('research')
})
