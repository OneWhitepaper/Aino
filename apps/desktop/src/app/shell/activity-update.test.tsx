import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { DesktopUpdateStatus } from '@/global'
import { en } from '@/i18n/en'
import { $cloudOwnsUpdates } from '@/store/cloud-updates'
import {
  $desktopVersion,
  $updateApply,
  $updateStatus,
  openUpdateOverlayFor,
  type UpdateApplyState
} from '@/store/updates'

import { ActivityUpdate } from './activity-update'

// This test replaces the computed ownership store with a writable fixture.
const ownership = $cloudOwnsUpdates as WritableAtom<{ client: boolean; backend: boolean }>

vi.mock('@/store/updates', async () => {
  const { atom } = await import('nanostores')

  return {
    $desktopVersion: atom(null),
    $updateApply: atom(null),
    $updateStatus: atom(null),
    openUpdateOverlayFor: vi.fn()
  }
})
vi.mock('@/store/cloud-updates', async () => {
  const { atom } = await import('nanostores')

  return { $cloudOwnsUpdates: atom({ client: false, backend: false }) }
})

const idle: UpdateApplyState = {
  applying: false,
  stage: 'idle',
  message: '',
  percent: null,
  error: null,
  command: null,
  log: []
}

beforeEach(() => {
  vi.clearAllMocks()
  $updateApply.set(idle)
  $updateStatus.set(null)
  $desktopVersion.set(null)
  ownership.set({ client: false, backend: false })
})
afterEach(cleanup)

it.each<DesktopUpdateStatus | null>([
  null,
  { supported: true, behind: 0 },
  { supported: false, updateAvailable: true },
  { supported: true, updateAvailable: true, error: 'check-failed' },
  { supported: true, updateAvailable: true, held: 'downgrade' },
  { supported: true, updateAvailable: true, rollback: true },
  { supported: true, updateAvailable: true, retirement: { state: 'discontinued', destination: 'stable', version: '1' } }
])('stays absent unless this app has an actionable update (%j)', status => {
  $updateStatus.set(status)
  render(<ActivityUpdate />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(openUpdateOverlayFor).not.toHaveBeenCalled()
})

it.each<DesktopUpdateStatus>([
  { supported: true, updateAvailable: true, mechanism: 'electron-updater', latestTag: 'v0.1.6' },
  { supported: true, updateAvailable: true, mechanism: 'app-installer' },
  { supported: true, behind: 2, mechanism: 'posix-handoff', targetSha: 'configured-source-target' }
])('opens client update details without changing context or starting installation (%j)', status => {
  const view = render(<ActivityUpdate />)
  act(() => $updateStatus.set(status))
  const label = [en.updates.availableTitle, status.latestTag].filter(Boolean).join(' · ')
  const button = screen.getByRole('button', { name: label })
  expect(button.getAttribute('data-update-state')).toBe('available')
  fireEvent.click(button)
  expect(openUpdateOverlayFor).toHaveBeenCalledExactlyOnceWith('client')
  view.rerender(<ActivityUpdate />)
  expect(screen.getByRole('button', { name: label })).toBe(button)
  act(() => $updateStatus.set({ supported: true, behind: 0 }))
  expect(screen.queryByRole('button')).toBeNull()
})

it('keeps genuine update progress and recovery reachable without surfacing background check failures', () => {
  render(<ActivityUpdate />)
  act(() => $updateApply.set({ ...idle, applying: true, stage: 'fetch', percent: 46 }))
  const button = screen.getByRole('button', { name: en.updates.stages.fetch })
  expect(button.getAttribute('data-update-state')).toBe('applying')
  fireEvent.click(button)
  expect(openUpdateOverlayFor).toHaveBeenLastCalledWith('client')

  act(() => $updateApply.set({ ...idle, stage: 'error', error: 'apply-failed' }))
  expect(screen.getByRole('button', { name: en.updates.errorTitle })).toBe(button)
  act(() => $updateApply.set(idle))
  expect(screen.queryByRole('button')).toBeNull()
  act(() => $updateStatus.set({ supported: true, updateAvailable: true }))
  act(() => ownership.set({ client: true, backend: true }))
  expect(screen.queryByRole('button')).toBeNull()
})

it('does not offer installation again when the new app is already installed and awaits restart', () => {
  $updateStatus.set({ supported: true, updateAvailable: true })
  $desktopVersion.set({
    appVersion: '0.1.6',
    electronVersion: '44',
    hermesRoot: '/test',
    nodeVersion: '26',
    platform: 'darwin',
    bundleSwapPending: true
  })
  render(<ActivityUpdate />)
  expect(screen.queryByRole('button')).toBeNull()
})
