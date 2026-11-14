import { expect, it, vi } from 'vitest'

import { PreviewBrowserChooser } from './preview-browser-chooser'
import type { PreviewGuestCdp } from './preview-guest-cdp'

function fixture() {
  const send = vi.fn(async (method: string): Promise<any> =>
    method === 'DOM.resolveNode' ? { object: { objectId: 'selected-input' } } : {}
  )

  const notify = vi.fn()
  let initialize: ((sessionId: string) => Promise<void>) | undefined

  const chooser = new PreviewBrowserChooser(
    {
      sendCommand: send,
      watchFrames: async (callback: typeof initialize) => {
        initialize = callback

        return () => {}
      },
      frameSessions: () => new Map()
    } as unknown as PreviewGuestCdp,
    notify
  )

  return { chooser, send, notify, initialize: (sessionId: string) => initialize?.(sessionId) }
}

it('resolves an intercepted chooser against its native node and CDP session without local path disclosure', async () => {
  const { chooser, send, notify } = fixture()
  await chooser.ready()
  chooser.opened(
    { backendNodeId: 81, mode: 'selectMultiple', frameId: 'child-frame' },
    4,
    'https://upload.example/',
    'child-session'
  )
  const receipt = chooser.status()!
  expect(receipt).toMatchObject({ state: 'pending', multiple: true, frame_id: 'child-frame' })
  expect(Object.keys(receipt).sort()).toEqual(['frame_id', 'id', 'multiple', 'state', 'url'])
  expect(send).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', { enabled: true })
  expect(await chooser.target(receipt.id, 4)).toEqual({
    objectId: 'selected-input',
    sessionId: 'child-session',
    chooserId: receipt.id
  })
  expect(send).toHaveBeenCalledWith('DOM.resolveNode', { backendNodeId: 81 }, 'child-session')
  chooser.finish(receipt.id, 4, 'completed')
  await expect(chooser.target(receipt.id, 4)).rejects.toThrow('no longer pending')
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ id: receipt.id, state: 'completed' }))
})

it('rejects a replaced chooser and navigation generations before resolving or cancelling its target', async () => {
  const { chooser, send } = fixture()
  chooser.opened({ backendNodeId: 13, mode: 'selectSingle' }, 1, 'https://upload.example/')
  const first = chooser.status()!
  await expect(chooser.target(first.id, 2)).rejects.toThrow('no longer pending')
  expect(send).not.toHaveBeenCalled()
  chooser.opened({ backendNodeId: 14, mode: 'selectSingle' }, 1, 'https://upload.example/')
  await expect(chooser.target(first.id, 1)).rejects.toThrow('no longer pending')
  const current = chooser.status()!
  await chooser.cancel(current.id, 1)
  expect(send).toHaveBeenCalledWith('DOM.setFileInputFiles', { files: [], backendNodeId: 14 }, undefined)
  expect(chooser.status()).toMatchObject({ state: 'cancelled' })
})

it('refuses an async native node resolution after that chooser is retired', async () => {
  const { chooser, send } = fixture()
  let complete!: (value: unknown) => void
  send.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  chooser.opened({ backendNodeId: 15, mode: 'selectSingle' }, 1, 'https://upload.example/')
  const waiting = chooser.target(chooser.status()!.id, 1)
  chooser.retire()
  complete({ object: { objectId: 'retired-input' } })
  await expect(waiting).rejects.toThrow('no longer pending')
  expect(chooser.status()).toMatchObject({ state: 'closed' })
})

it('intercepts owned iframe choosers through the shared frame session lifecycle', async () => {
  const { chooser, send, initialize } = fixture()
  await chooser.ready()
  await initialize('owned-child')
  expect(send).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', { enabled: true }, 'owned-child')
  chooser.dispose()
})
