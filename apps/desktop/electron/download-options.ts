import path from 'node:path'

import type { DownloadItem } from 'electron'

import { extensionForMimeType } from './preview-file-metadata'

/** Manual save picker policy; setSaveDialogOptions does not unset an agent's authorized setSavePath. */
export function configureDownloadSaveDialog(item: DownloadItem, downloadsDirectory: string, mediaName = ''): void {
  const suggested = mediaName || item.getFilename() || 'download'
  const extension = path.extname(suggested) ? '' : extensionForMimeType(item.getMimeType())
  item.setSaveDialogOptions({
    title: 'Save File',
    defaultPath: path.join(downloadsDirectory, `${suggested}${extension}`),
    filters:
      extension || /^image\//i.test(item.getMimeType() || '')
        ? [
            { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        : undefined
  })
}
