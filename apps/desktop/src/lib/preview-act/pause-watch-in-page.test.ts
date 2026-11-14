import { afterEach, expect, it, vi } from 'vitest'

import { pauseWatchInPage } from '../../../shared/preview-watch-pause'

import { watchInPage } from './watch-in-page'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).__hermesWatch
  document.querySelector('hermes-watch')?.remove()
  document.body.replaceChildren()
})

it('freezes cosmetic marks through approval and resumes expired marks while preserving pins and page nodes', () => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const target = document.createElement('button')
  document.body.append(target)
  const holder = { aimed: target }
  watchInPage(document, holder, 'pin', 'Saved pin')
  holder.aimed = target
  watchInPage(document, holder, 'aim')
  const state = (window as unknown as { __hermesWatch: { parts: { shadow: ShadowRoot } } }).__hermesWatch
  const shadow = state.parts.shadow
  const before = shadow.innerHTML

  pauseWatchInPage(document, true)
  watchInPage(document, holder, 'strike')
  vi.advanceTimersByTime(10_000)
  expect(shadow.innerHTML).toBe(before)
  expect(target.isConnected).toBe(true)
  pauseWatchInPage(document, false)
  expect(shadow.innerHTML).toContain('Saved pin')
  expect(shadow.innerHTML).not.toBe(before)
  expect(target.isConnected).toBe(true)
})

it('runs without module scope and does not delete page-created matching tags', () => {
  document.body.innerHTML = '<hermes-watch><button>Pay a recipient</button></hermes-watch>'
  const before = document.body.innerHTML
  const injected = new Function('return (' + pauseWatchInPage.toString() + ')')() as typeof pauseWatchInPage
  injected(document, true)
  injected(document, false)
  expect(document.body.innerHTML).toBe(before)
})

it('resolves pending cosmetic animation pauses synchronously without a rendering frame', () => {
  let time = 120
  let pending = false

  const animation = {
    playState: 'running',
    get currentTime() {return time},
    set currentTime(value: number) {time = value; pending = false},
    pause() {pending = true},
    play: vi.fn()
  }

  ;(window as unknown as { __hermesWatch: unknown }).__hermesWatch = {
    parts: { shadow: { getAnimations: () => [animation] } }
  }
  pauseWatchInPage(document, true)
  expect(pending).toBe(false)
  expect(animation.currentTime).toBe(120)
  pauseWatchInPage(document, false)
  expect(animation.play).toHaveBeenCalledOnce()
})
