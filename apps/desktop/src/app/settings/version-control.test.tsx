import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type * as Nanostores from 'nanostores'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'

const stores = vi.hoisted(() => {
  const { atom } = require('nanostores') as typeof Nanostores

  return {
    apply: atom({ applying: false, stage: 'idle', message: '' }),
    connection: atom({ mode: 'local' }),
    status: atom({ branch: 'main', currentSha: '476a88d9bb', behind: 0, updateAvailable: false }),
    version: atom({ appVersion: '0.21.0' })
  }
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      settings: {
        about: { versionUnavailable: 'Version unavailable' },
        nav: { about: 'About' },
        importConfig: 'Import config',
        exportConfig: 'Export config',
        resetToDefaults: 'Reset to defaults'
      },
      commandCenter: { settings: 'Settings' },
      ui: { accessibility: { moreActions: 'More actions' } },
      shell: {
        statusbar: {
          backendLabel: (value: string) => `backend v${value}`,
          backendVersion: (value: string) => `Backend v${value}`,
          branch: (value: string) => `branch ${value}`,
          clientLabel: (value: string) => `client v${value}`,
          commit: (value: string) => `commit ${value}`,
          commitsBehind: (count: number, branch: string) => `${count} commits behind ${branch}`,
          desktopVersion: (value: string) => `Hermes Desktop v${value}`,
          restart: 'restart',
          unknown: 'unknown',
          update: 'update',
          updateInProgress: 'Update in progress'
        }
      }
    }
  })
}))

vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/store/session', () => ({ $connection: stores.connection }))
vi.mock('@/store/updates', () => ({
  $desktopVersion: stores.version,
  $updateApply: stores.apply,
  $updateStatus: stores.status
}))

import { SettingsVersionControl } from './version-control'

beforeAll(() => {
  stubMenuDomApis()
  stubResizeObserver()
})
beforeEach(() => {
  stores.apply.set({ applying: false, stage: 'idle', message: '' })
  stores.status.set({ branch: 'main', currentSha: '476a88d9bb', behind: 0, updateAvailable: false })
})
afterEach(() => cleanup())

const callbacks = () => ({ onExport: vi.fn(), onImport: vi.fn(), onOpenAbout: vi.fn(), onReset: vi.fn() })

async function openMenu() {
  const trigger = screen.getByRole('button', { name: /More actions/ })
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
  fireEvent.click(trigger)

  return screen.findByRole('menu')
}

describe('SettingsVersionControl', () => {
  it.each([
    ['Import config', 'onImport'],
    ['Export config', 'onExport'],
    ['Reset to defaults', 'onReset'],
    ['About', 'onOpenAbout']
  ] as const)('keeps %s attached to its existing handler inside More actions', async (label, key) => {
    const props = callbacks()
    render(<SettingsVersionControl {...props} />)
    expect(screen.queryByText('v0.21.0')).toBeNull()
    await openMenu()
    expect(screen.getByText('v0.21.0')).toBeTruthy()
    expect(screen.getByText('476a88d')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(props[key]).toHaveBeenCalledOnce()
  })

  it('keeps updates discoverable while the menu is closed', async () => {
    stores.status.set({ branch: 'main', currentSha: '476a88d9bb', behind: 2, updateAvailable: true })
    const view = render(<SettingsVersionControl {...callbacks()} />)
    expect(screen.getByRole('button', { name: /More actions.*update/ })).toBeTruthy()
    expect(view.container.querySelector('.settings-update-indicator')).toBeTruthy()
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /About.*update/ })).toBeTruthy()
  })

  it('exposes applying progress without an extra persistent version row', () => {
    stores.apply.set({ applying: true, stage: 'restart', message: 'Restarting' })
    render(<SettingsVersionControl {...callbacks()} />)
    expect(screen.getByRole('button', { name: /More actions.*restart/ })).toBeTruthy()
  })
})
