/** Open DOM surfaces reachable from the preview's main document. Kept as a
 * self-contained factory because the same code is injected into the guest. */
export interface DomSurfaces {
  activeElement(): Element | null
  ancestors(el: Element): Element[]
  collect(selector: string): { elements: Element[]; opaqueFrames: number }
  contains(el: Element): boolean
  localPoint(el: Element): { x: number; y: number } | null
  point(el: Element): { x: number; y: number }
  scrollIntoView(el: Element): void
}

export function domSurfaces(doc: Document): DomSurfaces {
  const activeElement = () => {
    let active = doc.activeElement

    for (let depth = 0; active && depth < 32; depth++) {
      const inner =
        active.shadowRoot?.activeElement ??
        (active.tagName === 'IFRAME' || active.tagName === 'FRAME'
          ? (active as HTMLIFrameElement).contentDocument?.activeElement
          : null)

      if (!inner) {
        break
      }

      active = inner
    }

    return active
  }

  const parent = (el: Element): Element | null => {
    if (el.parentElement) {
      return el.parentElement
    }

    const root = el.getRootNode() as ShadowRoot

    if (root.nodeType === 11 && root.host) {
      return root.host
    }

    const owner = el.ownerDocument

    if (owner === doc) {
      return null
    }

    const frame = owner.defaultView?.frameElement as HTMLIFrameElement | null

    return frame?.contentDocument === owner ? frame : null
  }

  const ancestors = (el: Element): Element[] => {
    const result: Element[] = []
    let current: Element | null = el

    while (current && result.length < 256) {
      result.push(current)
      current = parent(current)
    }

    return result
  }

  const contains = (el: Element) => ancestors(el).some(node => node.ownerDocument === doc && doc.contains(node))

  const collect = (selector: string) => {
    if (selector.trim() === ':focus') {
      const active = activeElement()

      return { elements: active ? [active] : [], opaqueFrames: 0 }
    }

    const elements: Element[] = []
    let opaqueFrames = 0

    const walk = (root: Document | ShadowRoot, depth: number) => {
      if (depth > 32) {
        return
      }

      const selected = new Set(root.querySelectorAll(selector))

      // The query already walks this surface. Decorative nodes must not spend
      // a separate scan budget that silently hides controls later in the page.
      for (const el of root.querySelectorAll('*')) {
        if (selected.has(el)) {
          elements.push(el)
        }

        if (el.shadowRoot) {
          walk(el.shadowRoot, depth + 1)
        }

        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
          // Cross-origin frames deliberately stay opaque. Visual capture can
          // show their rendered pixels without granting script access.
          const child = (el as HTMLIFrameElement).contentDocument

          if (child) {
            walk(child, depth + 1)
          } else {
            opaqueFrames++
          }
        }
      }
    }

    walk(doc, 0)

    return { elements, opaqueFrames }
  }

  const localPoint = (el: Element): { x: number; y: number } | null => {
    const owner = el.ownerDocument
    const view = el.ownerDocument.defaultView
    // Wrapped inline controls have line boxes separated by non-clickable gaps.
    // Their union's centre can hit the parent rather than the control.
    const fragments = Array.from(el.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    const fallback = fragments[0] ?? el.getBoundingClientRect()
    const rects = fragments.length ? fragments : [fallback]
    const root = el.getRootNode() as Document | ShadowRoot
    const hitRoot = typeof root.elementFromPoint === 'function' ? root : owner
    let inViewport = false

    for (const rect of rects) {
      const left = Math.max(0, rect.left)
      const top = Math.max(0, rect.top)
      const right = Math.min(view?.innerWidth ?? rect.right, rect.right)
      const bottom = Math.min(view?.innerHeight ?? rect.bottom, rect.bottom)

      if (right <= left || bottom <= top) {
        continue
      }

      inViewport = true
      const point = { x: (left + right) / 2, y: (top + bottom) / 2 }

      if (typeof hitRoot.elementFromPoint !== 'function') {
        return point
      }

      const over = hitRoot.elementFromPoint(point.x, point.y)
      const shadowHost = root.nodeType === 11 && hitRoot === owner && over === (root as ShadowRoot).host

      if (over && (over === el || el.contains(over) || shadowHost)) {
        return point
      }
    }

    // Offscreen controls remain discoverable for scroll-to-target. A covered
    // on-screen target has no safe aim point and must not receive native input.
    return inViewport ? null : { x: fallback.left + fallback.width / 2, y: fallback.top + fallback.height / 2 }
  }

  const point = (el: Element) => {
    const local = localPoint(el)

    if (!local) {
      throw new Error('The target is covered. Observe the page again before acting.')
    }

    let { x, y } = local
    let owner = el.ownerDocument

    for (let depth = 0; owner !== doc && depth < 32; depth++) {
      const frame = owner.defaultView?.frameElement as HTMLIFrameElement | null

      if (!frame) {
        break
      }

      const bounds = frame.getBoundingClientRect()
      const scaleX = frame.offsetWidth ? bounds.width / frame.offsetWidth : 1
      const scaleY = frame.offsetHeight ? bounds.height / frame.offsetHeight : 1
      x = bounds.left + (frame.clientLeft + x) * scaleX
      y = bounds.top + (frame.clientTop + y) * scaleY
      owner = frame.ownerDocument
    }

    return { x: Math.round(x), y: Math.round(y) }
  }

  const scrollIntoView = (el: Element) => {
    el.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' })
    let owner = el.ownerDocument

    for (let depth = 0; owner !== doc && depth < 32; depth++) {
      const frame = owner.defaultView?.frameElement

      if (!frame) {
        break
      }

      frame.scrollIntoView?.({ behavior: 'instant', block: 'center', inline: 'nearest' })
      owner = frame.ownerDocument
    }
  }

  return { activeElement, ancestors, collect, contains, localPoint, point, scrollIntoView }
}
