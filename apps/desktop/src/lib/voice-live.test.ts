import { afterEach, expect, it, vi } from 'vitest'

import { VoiceLiveSession } from './voice-live'

afterEach(() => vi.unstubAllGlobals())

it('closing while microphone permission is pending stops the late stream without starting the old session', async () => {
  const peer = { addEventListener: vi.fn(), addTrack: vi.fn(), close: vi.fn(), createDataChannel: vi.fn() }
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      constructor() {
        return peer
      }
    }
  )
  vi.stubGlobal(
    'Audio',
    class {
      autoplay = false
      srcObject = null
      pause() {}
    }
  )
  let resolveMic!: (stream: MediaStream) => void
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(
        () =>
          new Promise(resolve => {
            resolveMic = resolve
          })
      )
    }
  })
  const stop = vi.fn()
  const closed = vi.fn()
  const session = new VoiceLiveSession({ onClosed: closed, onDelegation: vi.fn(), onError: vi.fn() })
  const pending = session.start([], { connectionId: 'first', profile: 'writer' })
  session.close()
  resolveMic({ getTracks: () => [{ stop }], getAudioTracks: () => [{ stop }] } as unknown as MediaStream)
  await pending
  expect(stop).toHaveBeenCalledOnce()
  expect(peer.addTrack).not.toHaveBeenCalled()
  expect(peer.createDataChannel).not.toHaveBeenCalled()
  expect(closed).toHaveBeenCalledOnce()
})
