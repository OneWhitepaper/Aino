/** Freeze only Aino's cosmetic work while every page node remains approval-visible.
 * Injected as source, so this function deliberately has no module references. */
export function pauseWatchInPage(doc: Document, paused: boolean): void {
  const win = doc.defaultView as (Window & { __hermesWatch?: Record<string, unknown> }) | null

  if (!win) {return}
  const state = win.__hermesWatch ??= {}

  if (!!state.paused === paused) {return}
  state.paused = paused

  if (paused) {
    if (state.raf) {win.cancelAnimationFrame(state.raf as number); state.raf = undefined}
    const parts = state.parts as { shadow: ShadowRoot } | undefined
    const animations = parts?.shadow.getAnimations?.().filter(animation => animation.playState === 'running') ?? []
    state.pausedAnimations = animations
    animations.forEach(animation => {
      const time = animation.currentTime ?? 0
      animation.pause()
      // Seeking resolves the pending pause synchronously, including views that never paint.
      animation.currentTime = time
    })
  } else {
    const animations = state.pausedAnimations as Animation[] | undefined
    animations?.forEach(animation => animation.play())
    state.pausedAnimations = undefined
    const expired = state.expired as HTMLElement[] | undefined
    expired?.forEach(cell => cell.remove())
    state.expired = undefined
    const pump = state.pump as (() => void) | undefined
    pump?.()
  }
}
