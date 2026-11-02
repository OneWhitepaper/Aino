import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $poolLimits, POOL_LIMITS_BOUNDS } from '@/store/pool-limits'

import { PoolLimitsSetting } from './pool-limits-setting'

const setPoolLimits = vi.fn()
const originalDesktopBridge = window.hermesDesktop

beforeEach(() => {
  $poolLimits.set({ maxBackends: 3, idleMs: 600000 })
  window.hermesDesktop = { setPoolLimits } as unknown as typeof window.hermesDesktop
  setPoolLimits.mockImplementation(async next => ({ limits: { ...$poolLimits.get(), ...next } }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.hermesDesktop = originalDesktopBridge
})

function mount(presentation?: 'page') {
  return render(
    <I18nProvider configClient={null} initialLocale="zh">
      <PoolLimitsSetting presentation={presentation} />
    </I18nProvider>
  )
}

it('keeps legacy presentation in milliseconds without a mount write', () => {
  mount()
  expect(screen.getByDisplayValue('600000')).toBeTruthy()
  expect(screen.getByText('ms')).toBeTruthy()
  expect(setPoolLimits).not.toHaveBeenCalled()
})

it('shows page idle limits in minutes while preserving their existing millisecond precision on blur', () => {
  $poolLimits.set({ maxBackends: 3, idleMs: 600001 })
  mount('page')
  const input = screen.getAllByRole('spinbutton')[1] as HTMLInputElement
  expect(input.value).toBe(String(600001 / 60000))
  expect(input.min).toBe(String(POOL_LIMITS_BOUNDS.idleMsMin / 60000))
  expect(input.max).toBe(String(POOL_LIMITS_BOUNDS.idleMsMax / 60000))
  fireEvent.focus(input)
  fireEvent.blur(input)
  expect(setPoolLimits).not.toHaveBeenCalled()
})

it('saves an edited minute amount through the existing millisecond storage contract', async () => {
  mount('page')
  const input = screen.getAllByRole('spinbutton')[1]
  fireEvent.change(input, { target: { value: '2.5' } })
  fireEvent.blur(input)
  await waitFor(() => expect(setPoolLimits).toHaveBeenCalledExactlyOnceWith({ idleMs: 150000 }))
  expect($poolLimits.get().idleMs).toBe(150000)
})

it('does not turn a blank minute or connection draft into a saved zero', () => {
  mount('page')

  for (const input of screen.getAllByRole('spinbutton')) {
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
  }

  expect(setPoolLimits).not.toHaveBeenCalled()
  expect(screen.getByDisplayValue('3')).toBeTruthy()
  expect(screen.getByDisplayValue('10')).toBeTruthy()
})

it('rolls a failed minute save back to the authoritative millisecond value', async () => {
  setPoolLimits.mockRejectedValue(new Error('write failed'))
  mount('page')
  const input = screen.getAllByRole('spinbutton')[1] as HTMLInputElement
  fireEvent.change(input, { target: { value: '2.5' } })
  fireEvent.blur(input)
  await waitFor(() => expect(input.value).toBe('10'))
  expect($poolLimits.get().idleMs).toBe(600000)
})
