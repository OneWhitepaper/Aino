import { createHash } from 'node:crypto'

import type { WebContents } from 'electron'

import { pauseWatchInPage } from '../shared/preview-watch-pause'

import { previewApprovalFrames } from './preview-approval-frames'
import { acquirePreviewGuestCdp } from './preview-guest-cdp'
import { isOwnedPreviewGuest } from './preview-guest-owner'

const CHANGED = 'The browser or embedded target changed during approval. Observe and confirm again.'

const MUTATIONS = new Set(['DOM.documentUpdated', 'DOM.attributeModified', 'DOM.attributeRemoved',
  'DOM.characterDataModified', 'DOM.childNodeInserted', 'DOM.childNodeRemoved', 'DOM.shadowRootPushed', 'DOM.shadowRootPopped'])

/** Decode the complete DOM, including closed roots, without trusting page tag names. */
export function previewApprovalFingerprint(snapshot: any): string {
  if (!Array.isArray(snapshot?.documents) || !snapshot.documents.length || !Array.isArray(snapshot.strings)) {
    throw new Error('Browser approval observation is unavailable')
  }

  const strings = snapshot.strings as string[]

  const documents = snapshot.documents.map((document: any) => {
    const nodes = document.nodes

    const rare = (field: any, index: number, string = false) => {
      const offset = field?.index?.indexOf(index) ?? -1

      return offset < 0 ? null : string ? strings[field.value[offset]] : field.value?.[offset] ?? true
    }

    const rows = nodes.nodeName.map((name: number, index: number) =>
      [nodes.backendNodeId[index], nodes.backendNodeId[nodes.parentIndex[index]] ?? null, strings[name], strings[nodes.nodeValue[index]],
        nodes.attributes[index]?.map((value: number) => strings[value]), rare(nodes.shadowRootType, index, true),
        rare(nodes.inputValue, index, true), rare(nodes.textValue, index, true), rare(nodes.inputChecked, index),
        rare(nodes.optionSelected, index), rare(nodes.contentDocumentIndex, index)])

    const layout = document.layout

    return [strings[document.frameId], strings[document.documentURL], rows,
      layout.nodeIndex.map((index: number, position: number) =>
        [nodes.backendNodeId[index], layout.bounds[position], strings[layout.text[position]],
          layout.styles[position]?.map((value: number) => strings[value])])]
  })

  return createHash('sha256').update(JSON.stringify(documents)).digest('hex')
}

/** A single activity lease owns this guard; no snapshot contents leave main. */
export async function createPreviewApproval(owner: WebContents, guest: WebContents) {
  const cdp = acquirePreviewGuestCdp(owner, guest)
  let changed = false
  let consumed = false
  let closed = false

  const frames = previewApprovalFrames(cdp, () => { if (!consumed) {changed = true} })

  const stop = cdp.listen((method, _params, sessionId) => {
    if (consumed || closed) {return}

    if (frames.ownsSession(sessionId) && MUTATIONS.has(method)) {changed = true}
  })

  const nativeFrames = () => guest.mainFrame.framesInSubtree
    .map(frame => `${frame.processId}:${frame.frameToken}:${frame.frameTreeNodeId}`).sort().join(',')

  const snapshot = async () => {
    const before = nativeFrames()
    const result = await frames.snapshot()

    if (before !== nativeFrames() || result.frameIds.size !== guest.mainFrame.framesInSubtree.length) {
      throw new Error('An embedded browser frame cannot be safely observed. Use manual control.')
    }

    return before + ':' + result.snapshots.map(previewApprovalFingerprint).sort().join(':')
  }

  let released: Promise<void> | undefined

  const pause = (value: boolean) => guest.executeJavaScript(`(${pauseWatchInPage.toString()})(document, ${value}); undefined`)

  const release = () => {
    if (released) {return released}
    closed = true
    stop()
    released = (async () => {
      // Native dialogs suspend guest JS. Queue cosmetic restoration without blocking
      // request release; Chromium runs it when the dialog closes, or rejects on teardown.
      if (!guest.isDestroyed()) {
        void pause(false).catch(error => {
          if (!guest.isDestroyed()) {console.warn('Could not restore browser approval overlay', error)}
        })
      }

      try {await frames.release()} finally {cdp.release()}
    })()

    return released
  }

  try {
    await pause(true)
    const baseline = await snapshot()
    changed = false

    const validate = async () => {
      if (closed || changed || (await snapshot()) !== baseline || changed || !isOwnedPreviewGuest(owner, guest)) {throw new Error(CHANGED)}
    }

    return {
      validate,
      async send(input: Electron.MouseInputEvent | Electron.KeyboardInputEvent | Electron.MouseWheelInputEvent) {
        if (!consumed) {await validate()}

        if (closed || changed || !isOwnedPreviewGuest(owner, guest)) {throw new Error(CHANGED)}

        if (input.type !== 'mouseMove' && input.type !== 'mouseUp' && input.type !== 'keyUp') {
          consumed = true
          guest.focus()
        }

        guest.sendInputEvent(input)
      },
      release
    }
  } catch (error) {
    await release()
    throw error
  }
}
