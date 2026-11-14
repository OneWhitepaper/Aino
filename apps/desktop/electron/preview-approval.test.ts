import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  release: vi.fn(),
  cdp: {
    sendCommand: vi.fn(async (method: string) => {
      if (method === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: 'root' } } }
      }

      if (method === 'DOM.getDocument') {
        return { root: { frameId: 'root' } }
      }

      if (method === 'Target.getTargets') {
        return { targetInfos: [] }
      }

      if (method === 'DOMSnapshot.captureSnapshot') {
        return {
          strings: ['root', 'https://example.test/', '#document', ''],
          documents: [
            {
              frameId: 0,
              documentURL: 1,
              nodes: { nodeName: [2], nodeValue: [3], backendNodeId: [1], parentIndex: [-1], attributes: [[]] },
              layout: { nodeIndex: [], bounds: [], text: [], styles: [] }
            }
          ]
        }
      }

      return {}
    }),
    listen: vi.fn(() => () => {}),
    frameSessions: () => new Map(),
    watchFrames: vi.fn(async () => () => {}),
    attachOwnedFrame: vi.fn(),
    release: vi.fn()
  }
}))

vi.mock('./preview-guest-cdp', () => ({ acquirePreviewGuestCdp: () => fixture.cdp }))
vi.mock('./preview-guest-owner', () => ({ isOwnedPreviewGuest: () => true }))

import { createPreviewApproval } from './preview-approval'

afterEach(() => vi.clearAllMocks())

it('releases native ownership without waiting for cosmetic JS blocked by a website dialog', async () => {
  let restore!: () => void

  const blocked = new Promise<void>(resolve => {
    restore = resolve
  })

  const frame = { processId: 1, frameToken: 'one', frameTreeNodeId: 1 }

  const guest = {
    isDestroyed: () => false,
    mainFrame: { framesInSubtree: [frame] },
    executeJavaScript: vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(blocked)
  }

  const approval = await createPreviewApproval({} as never, guest as never)
  const released = approval.release()

  const completed = await Promise.race([
    released.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 100))
  ])

  expect(completed).toBe(true)
  expect(fixture.cdp.release).toHaveBeenCalledOnce()
  expect(approval.release()).toBe(released)
  restore()
})

it('waits for Blink to acknowledge the prepared hover before taking the native baseline', async () => {
  const acknowledged = Promise.withResolvers<unknown>()
  fixture.cdp.sendCommand.mockImplementationOnce(() => acknowledged.promise as never)

  const guest = {
    isDestroyed: () => false,
    mainFrame: { framesInSubtree: [{ processId: 1, frameToken: 'one', frameTreeNodeId: 1 }] },
    executeJavaScript: vi.fn(async () => {})
  }

  const pending = createPreviewApproval(
    {} as never,
    guest as never,
    {
      x: 40,
      y: 20,
      type: 'mousePressed',
      button: 'left',
      clickCount: 1
    } as never
  )

  await Promise.resolve()
  expect(fixture.cdp.sendCommand).toHaveBeenCalledExactlyOnceWith('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    button: 'none',
    x: 40,
    y: 20
  })
  expect(guest.executeJavaScript).not.toHaveBeenCalled()
  acknowledged.resolve({})
  const approval = await pending
  expect(fixture.cdp.sendCommand).toHaveBeenCalledWith('DOMSnapshot.captureSnapshot', expect.anything(), undefined)
  await approval.validate()
  await approval.release()
})
