import type { PreviewGuestCdp } from './preview-guest-cdp'

const APPROVAL_STYLES = ['display', 'visibility', 'opacity', 'pointer-events', 'position', 'z-index', 'transform',
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'content', 'clip-path', 'overflow', 'filter']

const nodeFrames = (node: any): string[] => [
  ...(node.frameId ? [node.frameId] : []),
  ...[...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.contentDocument ? [node.contentDocument] : [])].flatMap(nodeFrames)
]

/** Resolve every frame through its existing CDP target, including out-of-process iframes. */
export function previewApprovalFrames(cdp: PreviewGuestCdp, changed: () => void) {
  const initialized = new Set<string>()
  const stops: Array<() => void> = []
  let watching: Promise<void> | undefined

  async function initialize(sessionId?: string) {
    const key = sessionId ?? ''

    if (initialized.has(key)) {return}
    await cdp.sendCommand('DOM.enable', {}, sessionId)
    await cdp.sendCommand('Page.enable', {}, sessionId)
    initialized.add(key)
  }

  const frameIds = (tree: any): string[] => [tree.frame.id, ...(tree.childFrames ?? []).flatMap(frameIds)]

  const snapshot = async () => {
    watching ??= cdp.watchFrames(initialize).then(stop => { stops.push(stop) })
    await watching
    const snapshots: any[] = []
    const pending: Array<string | undefined> = [undefined]
    const visited = new Set<string>()
    const seenFrames = new Set<string>()
    const expectedFrames = new Set<string>()

    while (pending.length) {
      const sessionId = pending.shift()

      if (visited.has(sessionId ?? '')) {continue}
      visited.add(sessionId ?? '')
      await initialize(sessionId)
      const tree = await cdp.sendCommand('Page.getFrameTree', {}, sessionId)
      const root = (await cdp.sendCommand('DOM.getDocument', { depth: -1, pierce: true }, sessionId)).root
      const result = await cdp.sendCommand('DOMSnapshot.captureSnapshot', { computedStyles: APPROVAL_STYLES }, sessionId)
      snapshots.push(result)

      for (const document of result.documents) {seenFrames.add(result.strings[document.frameId])}
      const targetInfos = (await cdp.sendCommand('Target.getTargets')).targetInfos as any[]
      const owned = new Set([...frameIds(tree.frameTree), ...nodeFrames(root)])

      for (const id of owned) {expectedFrames.add(id)}

      const childTargets = targetInfos.filter(target => target.type === 'iframe' &&
        (owned.has(target.parentId) || owned.has(target.parentFrameId))).map(target => target.targetId)

      for (const id of [...owned, ...childTargets]) {
        if (seenFrames.has(id)) {continue}
        pending.push(await cdp.attachOwnedFrame(id))
      }
    }

    if (expectedFrames.size !== seenFrames.size || [...expectedFrames].some(id => !seenFrames.has(id))) {
      throw new Error('An embedded browser frame cannot be safely observed. Use manual control.')
    }

    return { snapshots, frameIds: seenFrames }
  }

  const ownsSession = (sessionId?: string) => !sessionId || [...cdp.frameSessions().values()].includes(sessionId)
  // Frame/process topology changing and then changing back must not revive an approval.
  stops.push(cdp.listen((method, params, sessionId) => {
    if (method === 'Target.detachedFromTarget' && initialized.has(params.sessionId as string)) {changed()}

    if (ownsSession(sessionId) && ['Page.frameAttached', 'Page.frameDetached', 'Page.frameNavigated'].includes(method)) {changed()}
  }))

  return {
    snapshot,
    ownsSession,
    async release() {
      stops.forEach(stop => stop())
    }
  }
}
