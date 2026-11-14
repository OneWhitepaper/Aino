/** Electron replaces the main world's prompt with a throwing stub. Restore Blink's own modal. */
export function installPreviewGuestPrompt(): void {
  const restore = function (this: Window, ...args: Parameters<Window['prompt']>): ReturnType<Window['prompt']> {
    // A live same-origin about:blank realm still has Blink's native prompt.
    // Keep its realm alive through the modal; webviews suppress a prompt from a detached realm.
    const frame = document.createElement('iframe')
    frame.hidden = true
    document.documentElement.appendChild(frame)
    try {
      return frame.contentWindow!.prompt.apply(window, args)
    } finally {
      frame.remove()
    }
  }
  Object.defineProperty(window, 'prompt', { configurable: true, writable: true, value: restore })
}
