import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopUpdateStatus } from '@/global'
import { I18nProvider } from '@/i18n'
import { en } from '@/i18n/en'
import {
  $backendUpdateApply,
  $backendUpdateChecking,
  $backendUpdateStatus,
  $updateApply,
  $updateChecking,
  $updateStatus,
  checkBackendUpdates,
  checkUpdates,
  openUpdateOverlayFor,
  startActiveUpdate,
  type UpdateApplyState
} from '@/store/updates'

import { UpdateStatusCard } from './update-status'

vi.mock('@/store/updates', async () => {
  const { atom } = await import('nanostores')

  const idle: UpdateApplyState = {
    applying: false,
    stage: 'idle',
    message: '',
    percent: null,
    error: null,
    command: null,
    log: []
  }

  return {
    $backendUpdateApply: atom<UpdateApplyState>(idle),
    $backendUpdateChecking: atom(false),
    $backendUpdateStatus: atom<DesktopUpdateStatus | null>(null),
    $updateApply: atom<UpdateApplyState>(idle),
    $updateChecking: atom(false),
    $updateStatus: atom<DesktopUpdateStatus | null>(null),
    checkBackendUpdates: vi.fn().mockResolvedValue(null),
    checkUpdates: vi.fn().mockResolvedValue(null),
    openUpdateOverlayFor: vi.fn(),
    startActiveUpdate: vi.fn()
  }
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
  $backendUpdateApply.set(idle)
  $updateChecking.set(false)
  $backendUpdateChecking.set(false)
  $updateStatus.set(null)
  $backendUpdateStatus.set(null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('compact update status', () => {
  it('keeps dependency errors out of the page and reveals copyable details on request', async () => {
    const message = "Command failed: /private/install/bin/hermes\nModuleNotFoundError: No module named 'ruamel'"
    const writeClipboard = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('hermesDesktop', { writeClipboard })
    $updateStatus.set({ supported: true, error: 'check-failed', message })
    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <UpdateStatusCard target="client" variant="compact" />
      </I18nProvider>
    )

    expect(screen.queryByText(message)).toBeNull()
    expect(screen.getByText('更新组件缺少本地依赖。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    const dialog = screen.getByRole('dialog', { name: '更新检查详情' })

    expect(dialog.querySelector('pre')?.textContent).toBe(message + '\ncheck-failed')
    fireEvent.click(within(dialog).getByRole('button', { name: '复制详情' }))
    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(message + '\ncheck-failed'))
    vi.unstubAllGlobals()
  })

  it('routes checks and installs to their explicit client or backend target', async () => {
    $updateStatus.set({ supported: true, updateAvailable: true, behind: 2 })
    $backendUpdateStatus.set({ supported: true, updateAvailable: true, behind: 3 })
    const view = render(<UpdateStatusCard target="client" variant="compact" />)

    fireEvent.click(screen.getByRole('button', { name: en.updates.updateNow }))
    expect(startActiveUpdate).toHaveBeenLastCalledWith('client')
    view.rerender(<UpdateStatusCard target="backend" variant="compact" />)
    fireEvent.click(screen.getByRole('button', { name: en.updates.updateNow }))
    expect(startActiveUpdate).toHaveBeenLastCalledWith('backend')
    act(() => $backendUpdateStatus.set({ supported: true, behind: 0 }))
    fireEvent.click(screen.getByRole('button', { name: en.updates.checkNow }))
    await waitFor(() => expect(checkBackendUpdates).toHaveBeenCalledWith({ force: true }))
    expect(checkUpdates).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: en.updates.releaseNotes })).toBeNull()
  })

  it('keeps a failed check retry busy without exposing stale error details', () => {
    $updateStatus.set({ supported: true, error: 'check-failed', message: 'unknown transport failure' })
    $updateChecking.set(true)
    render(<UpdateStatusCard target="client" variant="compact" />)

    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull()
    expect(screen.getByRole('button', { name: en.updates.checkingShort }).hasAttribute('disabled')).toBe(true)
  })

  it('shows progress and opens the existing detailed flow without starting another install', () => {
    $updateStatus.set({ supported: true, updateAvailable: true })
    $updateApply.set({ ...idle, applying: true, stage: 'fetch', percent: 46 })
    render(<UpdateStatusCard target="client" variant="compact" />)

    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('46')
    expect(screen.queryByRole('button', { name: en.updates.updateNow })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }))
    expect(openUpdateOverlayFor).toHaveBeenCalledWith('client')
    expect(startActiveUpdate).not.toHaveBeenCalled()
  })

  it('keeps retirement visible and offers the supported installer instead of an install action', () => {
    $updateStatus.set({
      supported: true,
      retirement: { state: 'discontinued', destination: 'stable', version: '1.0.0' }
    })
    render(<UpdateStatusCard target="client" variant="compact" />)

    expect(screen.getByText('This build of Aino is no longer supported')).toBeTruthy()
    expect(screen.getByRole('link', { name: en.updates.openDownloadPage }).getAttribute('href')).toBe(
      'https://petoi.cn/download.html'
    )
    expect(screen.queryByRole('button', { name: en.updates.updateNow })).toBeNull()
  })

  it('distinguishes installation failure from a failed update check and keeps the existing recovery flow', () => {
    $updateStatus.set({ supported: true, updateAvailable: true })
    $updateApply.set({ ...idle, stage: 'error', error: 'apply-failed', message: 'installer returned code 1' })
    render(<UpdateStatusCard target="client" variant="compact" />)

    expect(screen.getByText(en.updates.errorTitle)).toBeTruthy()
    expect(screen.queryByText('Couldn’t check for updates')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }))
    expect(openUpdateOverlayFor).toHaveBeenCalledWith('client')
    expect(startActiveUpdate).not.toHaveBeenCalled()
  })

  it('does not declare network failure for an unknown check error', () => {
    $updateStatus.set({ supported: true, error: 'check-failed', message: 'configuration parser failed' })
    render(<UpdateStatusCard target="client" variant="compact" />)

    expect(screen.getByText('The update check did not finish.')).toBeTruthy()
    expect(screen.queryByText('The update service could not be reached.')).toBeNull()
    expect(screen.getByRole('button', { name: en.updates.checkNow })).toBeTruthy()
  })

  it('preserves manual and restart states without offering a second installation', () => {
    $updateStatus.set({ supported: true, updateAvailable: true })
    $updateApply.set({ ...idle, stage: 'manual', command: 'aino update' })
    render(<UpdateStatusCard target="backend" variant="compact" />)
    act(() => $backendUpdateApply.set({ ...idle, stage: 'manual', command: 'aino update' }))

    expect(screen.getByText('Update from your terminal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }))
    expect(openUpdateOverlayFor).toHaveBeenCalledWith('backend')
    act(() => $backendUpdateApply.set({ ...idle, stage: 'restart' }))
    expect(screen.getByText('Restarting Aino…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.updates.updateNow })).toBeNull()
  })
})
