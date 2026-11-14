/** Native input can precede Chromium's hover/style update. Injected without module state. */
export function settlePreviewInputInPage(doc: Document): Promise<void> {
  const win = doc.defaultView

  if (!win || doc.visibilityState === 'hidden') {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let frame = 0
    let remaining = 2
    const finish = (error?: Error) => {
      win.clearTimeout(timeout)
      win.cancelAnimationFrame(frame)
      doc.removeEventListener('visibilitychange', visibility)

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const visibility = () => {
      if (doc.visibilityState === 'hidden') {
        finish()
      }
    }
    const tick = () => {
      if (--remaining === 0) {
        finish()
      } else {
        frame = win.requestAnimationFrame(tick)
      }
    }
    const timeout = win.setTimeout(
      () => finish(new Error('Browser input did not finish rendering. Observe again.')),
      1500
    )
    doc.addEventListener('visibilitychange', visibility)
    frame = win.requestAnimationFrame(tick)
  })
}
