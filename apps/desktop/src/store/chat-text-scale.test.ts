import { beforeEach, expect, it, vi } from 'vitest'

const KEY = 'hermes.desktop.chat-text-scale.v1'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  document.documentElement.style.removeProperty('--chat-text-scale')
})

it('starts at the shared reading size when no chat scale was selected', async () => {
  const { $chatTextScale } = await import('./chat-text-scale')

  expect($chatTextScale.get()).toBe(100)
  expect(document.documentElement.style.getPropertyValue('--chat-text-scale')).toBe('1')
  expect(localStorage.getItem(KEY)).toBeNull()
})

it.each([110, 125, 150])('preserves an explicitly saved %s percent reading preference', async scale => {
  localStorage.setItem(KEY, String(scale))
  const { $chatTextScale } = await import('./chat-text-scale')

  expect($chatTextScale.get()).toBe(scale)
  expect(document.documentElement.style.getPropertyValue('--chat-text-scale')).toBe(String(scale / 100))
  expect(localStorage.getItem(KEY)).toBe(String(scale))
})

it('restores the selected chat scale without changing window zoom or global typography', async () => {
  const { $zoomPercent } = await import('./zoom')
  const zoom = $zoomPercent.get()
  const root = document.documentElement
  root.style.setProperty('--conversation-text-font-size', '13px')
  const { $chatTextScale, setChatTextScale, CHAT_TEXT_SCALE_PRESETS } = await import('./chat-text-scale')
  const selected = CHAT_TEXT_SCALE_PRESETS.find(value => value !== $chatTextScale.get())!

  setChatTextScale(selected)

  expect(root.style.getPropertyValue('--chat-text-scale')).toBe(String(selected / 100))
  expect(root.style.getPropertyValue('--conversation-text-font-size')).toBe('13px')
  expect($zoomPercent.get()).toBe(zoom)
  expect(localStorage.getItem(KEY)).toBe(String(selected))

  vi.resetModules()
  const restored = await import('./chat-text-scale')
  expect(restored.$chatTextScale.get()).toBe(selected)
  root.style.removeProperty('--conversation-text-font-size')
})

it('falls back to the default for invalid storage and keeps an explicit 100% selection', async () => {
  const initial = await import('./chat-text-scale')
  const fallback = initial.$chatTextScale.get()

  localStorage.setItem(KEY, 'not-a-scale')
  vi.resetModules()
  const { $chatTextScale, setChatTextScale } = await import('./chat-text-scale')
  expect($chatTextScale.get()).toBe(fallback)
  expect(document.documentElement.style.getPropertyValue('--chat-text-scale')).toBe(String(fallback / 100))

  setChatTextScale(100)
  vi.resetModules()
  const restored = await import('./chat-text-scale')
  expect(restored.$chatTextScale.get()).toBe(100)
  restored.setChatTextScale(fallback)
  expect(localStorage.getItem(KEY)).toBeNull()
})
