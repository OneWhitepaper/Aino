import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { type MicRecorderErrorCopy, useMicRecorder } from './use-mic-recorder'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('stops a late microphone permission stream after its owning recorder was cancelled', async () => {
  let grant!: (stream: MediaStream) => void
  const stop = vi.fn()
  const Recorder = vi.fn()
  vi.stubGlobal('MediaRecorder', Recorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>(resolve => {
            grant = resolve
          })
      )
    }
  })
  const { result, unmount } = renderHook(() => useMicRecorder({} as MicRecorderErrorCopy))
  let pending!: Promise<void>
  await act(async () => {
    pending = result.current.handle.start()
    await Promise.resolve()
  })
  act(() => result.current.handle.cancel())
  unmount()
  await act(async () => {
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await pending
  })
  expect(stop).toHaveBeenCalledOnce()
  expect(Recorder).not.toHaveBeenCalled()
})
