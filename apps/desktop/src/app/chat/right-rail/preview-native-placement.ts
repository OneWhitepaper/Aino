import type { NativePreviewBounds, NativePreviewBridge } from '../../../../shared/preview-native'

/** Native children sit above renderer layers. Yield while chrome overlays overlap them. */
const OVERLAYS =
  '[data-slot="dialog-overlay"], [role="dialog"], [role="alertdialog"], [role="menu"], ' +
  '[data-slot="popover-content"], [data-annotate-card], .notification-summary, .notification-feedback'

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

function visibleOverlayOverlaps(overlay: HTMLElement, rect: DOMRect): boolean {
  const style = getComputedStyle(overlay)

  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    overlay.dataset.state !== 'closed' &&
    overlaps(rect, overlay.getBoundingClientRect())
  )
}

export function nativePreviewPlacement(element: HTMLElement): {
  bounds: NativePreviewBounds
  visible: boolean
  covered: boolean
  blocking: boolean
} {
  const rect = element.getBoundingClientRect()
  const zoom = window.hermesDesktop?.zoom?.factor?.() || 1
  let visible =
    element.isConnected && rect.width > 0 && rect.height > 0 && !element.closest('[data-pane-hidden], [inert]')

  for (let node: HTMLElement | null = element; visible && node; node = node.parentElement) {
    const style = getComputedStyle(node)
    visible = style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
  }

  const blocking =
    visible &&
    (document.body.classList.contains('guest-pointer-lock') ||
      [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some(overlay => visibleOverlayOverlaps(overlay, rect)))

  const covered =
    blocking ||
    (visible &&
      [...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')].some(overlay =>
        visibleOverlayOverlaps(overlay, rect)
      ))

  return {
    bounds: {
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.max(1, Math.round(rect.width * zoom)),
      height: Math.max(1, Math.round(rect.height * zoom))
    },
    visible: visible && !covered,
    covered,
    blocking
  }
}

export function watchNativePreviewPlacement(
  element: HTMLElement,
  bridge: NativePreviewBridge,
  token: string
): () => void {
  let frame = 0
  let stopped = false
  let previous = ''
  let coveredBefore = false
  let captureEpoch = 0
  let backdropReady = false

  const captureBackdrop = (epoch: number) => {
    const surface = element as HTMLElement & { getWebContentsId: () => number }
    // Native content stays live for a label until its replacement is decoded.
    // Interactive overlays still hide it immediately to retain input safety.
    void window.hermesDesktop
      ?.capturePreview?.({ webContentsId: surface.getWebContentsId() })
      .then(async image => {
        if (stopped || captureEpoch !== epoch || !coveredBefore) {
          return
        }
        const decoded = new Image()
        decoded.src = image
        await decoded.decode()

        if (!stopped && captureEpoch === epoch && coveredBefore) {
          element.style.backgroundImage = `url("${image}")`
          element.style.backgroundSize = '100% 100%'
          backdropReady = true
          schedule()
        }
      })
      .catch(() => {})
  }

  const sync = () => {
    frame = 0
    const placement = nativePreviewPlacement(element)

    if (placement.covered !== coveredBefore) {
      captureEpoch++
      backdropReady = false
      coveredBefore = placement.covered

      if (placement.covered) {
        captureBackdrop(captureEpoch)
      }
    }

    // Keep the last decoded image underneath the returning native surface:
    // setVisible paints asynchronously, so clearing first exposes a blank frame.
    const visible = placement.visible || (placement.covered && !placement.blocking && !backdropReady)
    const key = JSON.stringify([placement.bounds, visible])

    if (key !== previous) {
      previous = key
      bridge.layout(token, placement.bounds, visible)
    }
  }

  const schedule = () => {
    if (!stopped && !frame) {
      frame = window.requestAnimationFrame(sync)
    }
  }

  const mutations = new MutationObserver(schedule)
  mutations.observe(document.body, { attributes: true, childList: true, subtree: true })
  const resize = new ResizeObserver(schedule)
  resize.observe(element)
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('transitionend', schedule, true)
  schedule()

  return () => {
    stopped = true
    captureEpoch++
    mutations.disconnect()
    resize.disconnect()
    window.cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('transitionend', schedule, true)
    element.style.backgroundImage = ''
  }
}
