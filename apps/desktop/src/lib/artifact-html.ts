import { localizedPreviewError } from '@/i18n/preview-errors'
import type { Translations } from '@/i18n/types'
import { notifyError } from '@/store/notifications'

/** Full documents pass through; fragments get a standards-mode shell. */
export function composeArtifactHtml(content: string): string {
  if (/<html[\s>]|<!doctype\s+html/i.test(content)) {
    return content
  }

  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>',
    content,
    '</body></html>'
  ].join('\n')
}

export function canOpenHtmlArtifactExternally(): boolean {
  return typeof window.hermesDesktop?.saveImageBuffer === 'function'
}

/** Only called by explicit app-owned actions, never by the preview document. */
export async function openHtmlArtifactExternally(content: string, t: Translations, appId?: string): Promise<void> {
  const bridge = window.hermesDesktop

  try {
    const bytes = new TextEncoder().encode(composeArtifactHtml(content))

    if (appId !== undefined) {
      if (!bridge?.previewBrowserApps) {
        throw new Error('Desktop preview browser bridge is unavailable')
      }

      await bridge.previewBrowserApps.open(appId, bytes)

      return
    }

    if (!bridge?.saveImageBuffer) {
      throw new Error('Desktop bridge unavailable')
    }

    const target = await bridge.saveImageBuffer(bytes, '.html')

    if (!target) {
      throw new Error('Could not write artifact file')
    }

    // A native path goes to the OS file handler; a file: URL only reveals it.
    // The browser host instead returns a blob URL for its sandboxed document.
    if (bridge.openPreviewInBrowser) {
      await bridge.openPreviewInBrowser(target)
    } else {
      await bridge.openExternal(target)
    }
  } catch (error) {
    notifyError(
      appId === undefined ? new Error(localizedPreviewError(t, error)) : error,
      t.artifactPreview.openExternallyFailed
    )
  }
}
