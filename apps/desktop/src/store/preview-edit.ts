import { atom } from 'nanostores'

// URLs of preview targets that have unsaved spot-editor changes, keyed by
// `target.url` so the rail can render a VS Code-style "modified" dot on the tab
// without threading editor state up through the pane. The editor in
// `preview-file.tsx` is the sole writer; the rail tabs are the readers.
export const $dirtyPreviewUrls = atom<Record<string, true>>({})
const $dirtyPreviewWriters = atom<Record<string, string>>({})
export const $pendingPreviewClose = atom<string | null>(null)
export const cancelPreviewClose = () => $pendingPreviewClose.set(null)
const previewSavers = new Map<string, () => Promise<boolean>>()

export function registerPreviewSaver(tabId: string, save: () => Promise<boolean>): () => void {
  previewSavers.set(tabId, save)

  return () => {
    if (previewSavers.get(tabId) === save) {
      previewSavers.delete(tabId)
    }
  }
}

export async function savePreviewTab(tabId: string): Promise<boolean> {
  return (await previewSavers.get(tabId)?.()) ?? false
}

export function previewTabIsDirty(tabId: string, url: string): boolean {
  const writers = $dirtyPreviewWriters.get()

  return writers[tabId] === url || writers[url] === url
}

export function setPreviewDirty(url: string, dirty: boolean, tabId = url): void {
  if (!url) {
    return
  }

  const current = $dirtyPreviewWriters.get()
  const has = current[tabId] === url

  if (dirty === has) {
    return
  }

  if (dirty) {
    const next = { ...current, [tabId]: url }
    $dirtyPreviewWriters.set(next)
    $dirtyPreviewUrls.set(Object.fromEntries(Object.values(next).map(value => [value, true as const])))

    return
  }

  const next = { ...current }
  delete next[tabId]
  $dirtyPreviewWriters.set(next)
  $dirtyPreviewUrls.set(Object.fromEntries(Object.values(next).map(value => [value, true as const])))
}
