/** Chromium's CDP opening notification can precede Electron's authoritative native callback. */
export async function waitForNativePreviewDialog(request, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const status = await request('dialog_status')
    const pending = status.dialogs?.find(dialog => dialog.state === 'pending')
    if (pending) return { status, pending }
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('The native dialog callback did not become available')
}
