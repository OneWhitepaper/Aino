import type { WebContents } from 'electron'

export type PreviewPageZoomMode = 'fit' | 'manual'

interface ZoomOptions {
  width: () => number
  canFit: () => boolean
  changed: () => void
}

interface PageMeasure {
  viewport: number
  width: number
}

const MEASURE = `(() => ({ viewport: innerWidth, width: Math.max(innerWidth,
  document.documentElement.scrollWidth, document.body?.scrollWidth || 0) }))()`

/** Fit only genuine horizontal overflow; responsive documents retain their normal size. */
export function createPreviewPageZoom(guest: Pick<WebContents, 'setZoomMode' | 'getZoomFactor' | 'setZoomFactor' | 'executeJavaScript'>, options: ZoomOptions) {
  guest.setZoomMode('isolated')
  let mode: PreviewPageZoomMode = 'fit'
  let requiredWidth: number | undefined
  let generation = 0
  let disposed = false
  let measuring: Promise<void> | undefined
  let measureAgain = false

  const apply = (factor: number, modeChanged = false) => {
    const changed = Math.abs(guest.getZoomFactor() - factor) > 0.001

    if (changed) {guest.setZoomFactor(factor)}
    if (changed || modeChanged) {options.changed()}
  }

  const canFit = () => !disposed && mode === 'fit' && options.width() > 1 && options.canFit()
  const fitFactor = () => requiredWidth ? Math.max(0.5, Math.min(1, options.width() / requiredWidth)) : 1

  const refresh = (): Promise<void> => {
    const revision = ++generation

    if (!canFit()) {return Promise.resolve()}
    apply(fitFactor())

    if (measuring) {
      measureAgain = true

      return measuring
    }

    const current = guest.executeJavaScript(MEASURE).then((measure: PageMeasure) => {
      if (revision !== generation || !canFit()) {return}

      if (!measure || !Number.isFinite(measure.width) || !Number.isFinite(measure.viewport) || measure.viewport < 1) {
        throw new Error('Browser returned an invalid page width')
      }

      // After fitting, innerWidth expands. Remember the original overflow width
      // instead of using that expanded viewport as a new reason to shrink.
      if (measure.width > measure.viewport + 2) {requiredWidth = measure.width}
      requiredWidth ??= 0
      apply(fitFactor())
    }).catch(error => {
      if (revision === generation && canFit()) {console.warn('Browser page fitting unavailable', error)}
    }).finally(() => {
      if (measuring !== current) {return}
      measuring = undefined

      if (measureAgain) {
        measureAgain = false
        void refresh()
      }
    })
    measuring = current

    return measuring
  }

  return {
    get mode(): PreviewPageZoomMode {return mode},
    refresh,
    invalidate(newDocument = false) {
      generation++
      measuring = undefined
      measureAgain = false

      if (newDocument) {requiredWidth = undefined}
    },
    set(value: unknown): Promise<void> {
      if (value !== 'fit' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        throw new Error('Invalid Browser page zoom')
      }

      generation++
      measuring = undefined
      measureAgain = false
      const next = value === 'fit' ? 'fit' : 'manual'
      const changed = next !== mode
      mode = next

      if (mode === 'manual') {
        apply(Math.max(0.25, Math.min(3, value as number)), changed)

        return Promise.resolve()
      }

      requiredWidth = undefined
      if (changed) {options.changed()}

      return refresh()
    },
    dispose() {disposed = true; generation++}
  }
}

export type PreviewPageZoom = ReturnType<typeof createPreviewPageZoom>
