import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale, translateNow } from '@/i18n'
import { $desktopBoot } from '@/store/boot'

import { UpdateHoldOverlay } from './update-hold-overlay'

const originalDesktop = window.hermesDesktop
const originalBoot = $desktopBoot.get()

const hold = {
  holdId: 'held-update',
  verdict: 'held' as const,
  ownerPid: 123,
  since: 1_000,
  checkedAt: 2_000,
  logPath: '/logs/update.log'
}

function rig() {
  const updateHold = {
    recheck: vi.fn().mockResolvedValue({ ok: true }),
    quit: vi.fn().mockResolvedValue({ ok: true }),
    startAnyway: vi.fn().mockResolvedValue({ ok: false })
  }

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { updateHold, revealLogs: vi.fn().mockResolvedValue(undefined) }
  })

  return updateHold
}

beforeEach(() => {
  setRuntimeI18nLocale('en')
  $desktopBoot.set({ ...originalBoot, error: null, updateHold: hold })
})
afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $desktopBoot.set(originalBoot)
})

describe('UpdateHoldOverlay safety', () => {
  it('traps focus on the safe recheck action and cannot dismiss a held update with Escape', async () => {
    const bridge = rig()
    render(
      <>
        <button type="button">Background action</button>
        <UpdateHoldOverlay />
      </>
    )
    const overlay = screen.getByRole('alertdialog')
    const recheck = screen.getByRole('button', { name: translateNow('boot.updateHold.checkAgain') })
    await waitFor(() => expect(globalThis.document.activeElement).toBe(recheck))
    screen.getByText('Background action').focus()
    expect(overlay.contains(globalThis.document.activeElement)).toBe(true)
    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBe(overlay)
    expect(bridge.startAnyway).not.toHaveBeenCalled()
  })

  it('requires a second explicit action to start, defaults to keeping the hold, and exposes a refused start', async () => {
    const bridge = rig()
    render(<UpdateHoldOverlay />)
    fireEvent.click(screen.getByRole('button', { name: translateNow('boot.updateHold.startAnyway') }))
    const keepWaiting = screen.getByRole('button', { name: translateNow('boot.updateHold.confirmKeepWaiting') })
    await waitFor(() => expect(globalThis.document.activeElement).toBe(keepWaiting))
    expect(bridge.startAnyway).not.toHaveBeenCalled()
    fireEvent.click(keepWaiting)
    expect(bridge.startAnyway).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: translateNow('boot.updateHold.startAnyway') }))
    fireEvent.click(screen.getByRole('button', { name: translateNow('boot.updateHold.confirmStart') }))
    await waitFor(() =>
      expect(bridge.startAnyway).toHaveBeenCalledExactlyOnceWith({ holdId: hold.holdId, confirmed: true })
    )
    expect((await screen.findByRole('alert')).textContent).toBe(translateNow('boot.updateHold.startAnywayRefused'))
    expect(
      screen.getByRole('button', { name: translateNow('boot.updateHold.checkAgain') }).hasAttribute('disabled')
    ).toBe(false)
  })

  it('finishes a recheck only when a new status arrives and clears confirmation when its hold changes', async () => {
    rig()
    render(<UpdateHoldOverlay />)
    const checkAgain = screen.getByRole('button', { name: translateNow('boot.updateHold.checkAgain') })
    fireEvent.click(checkAgain)
    await act(async () => {})
    expect(checkAgain.hasAttribute('disabled')).toBe(true)
    act(() => $desktopBoot.set({ ...$desktopBoot.get(), updateHold: { ...hold, checkedAt: hold.checkedAt + 1 } }))
    expect(checkAgain.hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: translateNow('boot.updateHold.startAnyway') }))
    act(() => $desktopBoot.set({ ...$desktopBoot.get(), updateHold: { ...hold, holdId: 'another-held-update' } }))
    expect(screen.queryByRole('button', { name: translateNow('boot.updateHold.confirmStart') })).toBeNull()
  })
})
