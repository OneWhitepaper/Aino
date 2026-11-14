import { afterEach, expect, it, vi } from 'vitest'

import { settlePreviewInputInPage } from '../../../shared/preview-settle-input'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function rendering(visibility = 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibility })
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback)

    return frames.length
  })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

  return { frames, cancel }
}

it('settles queued hover input after two visible renders without module scope', async () => {
  const { frames, cancel } = rendering()

  const injected = new Function(
    'return (' + settlePreviewInputInPage.toString() + ')'
  )() as typeof settlePreviewInputInPage

  let settled = false

  const pending = injected(document).then(() => {
    settled = true
  })

  frames[0](0)
  await Promise.resolve()
  expect(settled).toBe(false)
  frames[1](16)
  await pending
  expect(settled).toBe(true)
  expect(cancel).toHaveBeenCalledOnce()
})

it('never waits for a paint from a hidden or newly hidden browser', async () => {
  const { frames, cancel } = rendering('hidden')
  await settlePreviewInputInPage(document)
  expect(frames).toHaveLength(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  const pending = settlePreviewInputInPage(document)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
  await pending
  expect(cancel).toHaveBeenCalledOnce()
})

it('rejects an unresponsive visible renderer instead of accepting an unrendered baseline', async () => {
  vi.useFakeTimers()
  rendering()
  const pending = settlePreviewInputInPage(document)
  const rejected = expect(pending).rejects.toThrow('did not finish rendering')
  await vi.advanceTimersByTimeAsync(1500)
  await rejected
})
