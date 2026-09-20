import { hermesApi } from '@/api/client'
import type { HermesReadFileTextResult } from '@/global'

export interface PreviewFilesystemSource {
  connectionId: string
  profile: string
}
export function readScopedPreviewText(source: PreviewFilesystemSource, path: string) {
  return hermesApi<HermesReadFileTextResult>({ ...source, path: `/api/fs/read-text?path=${encodeURIComponent(path)}` })
}
export async function readScopedPreviewDataUrl(source: PreviewFilesystemSource, path: string) {
  const result = await hermesApi<string | { dataUrl?: string }>({
    ...source,
    path: `/api/fs/read-data-url?path=${encodeURIComponent(path)}`
  })
  return typeof result === 'string' ? result : result.dataUrl || ''
}
export function writeScopedPreviewText(source: PreviewFilesystemSource, path: string, content: string) {
  return hermesApi({ ...source, path: '/api/fs/write-text', method: 'POST', body: { path, content } })
}
