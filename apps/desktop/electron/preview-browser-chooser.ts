import { randomUUID } from 'node:crypto'

import type { WebContents } from 'electron'

import type { PreviewBrowserFileChooser } from '../shared/preview-browser-interactions'

import type { PreviewGuestCdp } from './preview-guest-cdp'

interface PendingChooser {
  receipt: PreviewBrowserFileChooser
  backendNodeId: number
  generation: number
  sessionId?: string
}

export interface PreviewUploadTarget {
  objectId: string
  sessionId?: string
  chooserId?: string
}

/** Intercept only the browser's real file chooser; no page-supplied node or local path is trusted. */
export class PreviewBrowserChooser {
  private pending?: PendingChooser
  private receipt?: PreviewBrowserFileChooser
  private stopFrames?: () => void

  constructor(
    private cdp: PreviewGuestCdp,
    private notify: (chooser: PreviewBrowserFileChooser) => void
  ) {}

  async ready(): Promise<void> {
    await this.cdp.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
    this.stopFrames = await this.cdp.watchFrames(sessionId =>
      this.cdp.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId)
    )
  }

  opened(params: Record<string, unknown>, generation: number, url: string, sessionId?: string): void {
    if (!Number.isSafeInteger(params.backendNodeId) || (params.backendNodeId as number) <= 0) {
      return
    }

    this.retire()

    const receipt: PreviewBrowserFileChooser = {
      id: randomUUID(),
      url,
      multiple: params.mode === 'selectMultiple',
      state: 'pending',
      ...(typeof params.frameId === 'string' ? { frame_id: params.frameId } : {})
    }

    this.pending = { receipt, backendNodeId: params.backendNodeId as number, generation, sessionId }
    this.receipt = receipt
    this.notify({ ...receipt })
  }

  status(): PreviewBrowserFileChooser | undefined {
    return this.receipt && { ...this.receipt }
  }

  assert(chooserId: string, generation: number): PendingChooser {
    const pending = this.pending

    if (!pending || pending.receipt.id !== chooserId || pending.generation !== generation) {
      throw new Error('The website file chooser is no longer pending. Open it again.')
    }

    return pending
  }

  async target(chooserId: string, generation: number): Promise<PreviewUploadTarget> {
    const pending = this.assert(chooserId, generation)

    const response = await this.cdp.sendCommand(
      'DOM.resolveNode',
      { backendNodeId: pending.backendNodeId },
      pending.sessionId
    )

    this.assert(chooserId, generation)

    if (!response.object?.objectId) {
      throw new Error('The website upload input is unavailable')
    }

    return { objectId: response.object.objectId, sessionId: pending.sessionId, chooserId }
  }

  finish(chooserId: string, generation: number, state: 'completed' | 'cancelled'): void {
    const pending = this.assert(chooserId, generation)
    pending.receipt.state = state
    this.pending = undefined
    this.notify({ ...pending.receipt })
  }

  retire(): void {
    if (!this.pending) {
      return
    }

    this.pending.receipt.state = 'closed'
    this.notify({ ...this.pending.receipt })
    this.pending = undefined
  }

  async cancel(chooserId: string, generation: number): Promise<void> {
    const pending = this.assert(chooserId, generation)
    await this.cdp.sendCommand(
      'DOM.setFileInputFiles',
      { files: [], backendNodeId: pending.backendNodeId },
      pending.sessionId
    )
    this.finish(chooserId, generation, 'cancelled')
  }

  async choose(owner: WebContents, chooserId: string, generation: number): Promise<string[] | undefined> {
    const pending = this.assert(chooserId, generation)
    const { BrowserWindow, dialog } = await import('electron')
    const window = BrowserWindow.fromWebContents(owner)

    if (!window || window.isDestroyed()) {
      throw new Error('The Browser window is unavailable')
    }

    const result = await dialog.showOpenDialog(window, {
      title: `Upload files to ${pending.receipt.url}`,
      properties: pending.receipt.multiple ? ['openFile', 'multiSelections'] : ['openFile']
    })

    this.assert(chooserId, generation)

    return result.canceled ? undefined : result.filePaths
  }

  dispose(): void {
    this.retire()
    this.stopFrames?.()
    void this.cdp.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)

    for (const sessionId of this.cdp.frameSessions().values()) {
      void this.cdp
        .sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId)
        .catch(() => undefined)
    }
  }
}
