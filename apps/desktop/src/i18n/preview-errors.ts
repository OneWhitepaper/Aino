import type { Translations } from './types'

/** Fixed errors emitted by the desktop preview implementation itself. */
const PREVIEW_ERROR_KEYS = {
  'Could not write artifact file': 'artifactWriteFailed',
  'Could not stage remote HTML preview': 'artifactWriteFailed',
  'Desktop bridge unavailable': 'desktopBridgeUnavailable',
  'Desktop preview browser bridge is unavailable': 'desktopBridgeUnavailable',
  'Desktop preview buffer bridge is unavailable': 'desktopBridgeUnavailable',
  'Invalid PDF data URL': 'invalidPdfDataUrl',
  'Invalid PDF data URL payload': 'invalidPdfDataUrlPayload',
  'Invalid PDF data URL type': 'invalidPdfDataUrlType',
  'Invalid PDF file header': 'invalidPdfFileHeader',
  'PDF preview requires object URL support': 'pdfObjectUrlUnsupported',
  'Remote HTML preview could not be loaded': 'unavailable',
  'preview webview cannot take input events': 'webviewInputUnavailable',
  'preview webview is not ready': 'webviewNotReady'
} as const satisfies Record<string, keyof Translations['preview']>

const PREVIEW_TARGET_ERROR = /^Could not open preview target: (.+)$/

/**
 * Translate only errors whose English text is owned by the desktop preview.
 * Backend errors, file-system messages, URLs, and user/generated content pass
 * through unchanged so diagnostics remain actionable and truthful.
 */
export function localizedPreviewError(translations: Translations, error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  const message = raw.replace(/^Error:\s*/, '')
  const key = PREVIEW_ERROR_KEYS[message as keyof typeof PREVIEW_ERROR_KEYS]

  const targetMatch = message.match(PREVIEW_TARGET_ERROR)

  if (targetMatch) {
    return translations.preview.couldNotOpenTarget(targetMatch[1])
  }

  return key ? (translations.preview[key] as string) : raw
}
