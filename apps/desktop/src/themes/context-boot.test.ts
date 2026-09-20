import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const originalUrl = window.location.href

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('hermes-desktop-mode-v1', 'light')
})

afterEach(() => {
  window.history.replaceState(null, '', originalUrl)
  vi.unstubAllGlobals()
})

it('paints the intro without taking ownership of the native theme', async () => {
  const setNativeTheme = vi.fn()
  vi.stubGlobal('hermesDesktop', { setNativeTheme })
  window.history.replaceState(null, '', '?win=intro')

  await import('./context')

  expect(document.documentElement.dataset.hermesMode).toBe('light')
  expect(setNativeTheme).not.toHaveBeenCalled()
})

it('lets the main window publish the native theme on boot', async () => {
  const setNativeTheme = vi.fn()
  vi.stubGlobal('hermesDesktop', { setNativeTheme })
  window.history.replaceState(null, '', originalUrl)

  await import('./context')

  expect(setNativeTheme).toHaveBeenCalledWith('light')
})
