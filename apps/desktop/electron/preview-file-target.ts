import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { app } from 'electron'

import { homeRelativeAttachmentCandidates, resolveReadableFileForIpc, resolveRequestedPathForIpc } from './hardening'
import { resolvePreviewTargetPath } from './local-read-path'
import {
  mimeTypeForPath,
  PREVIEW_HTML_EXTENSIONS,
  PREVIEW_LANGUAGE_BY_EXT,
  PREVIEW_PDF_EXTENSIONS,
  previewFileMetadata
} from './preview-file-metadata'
import { previewHttpUrlTarget } from './preview-url-target'

export function expandUserPath(filePath) {
  const value = String(filePath || '').trim()

  if (value === '~') {
    return app.getPath('home')
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(app.getPath('home'), value.slice(2))
  }

  return value
}

function filePreviewKind(ext: string, mimeType: string, binary: boolean) {
  const isHtml = PREVIEW_HTML_EXTENSIONS.has(ext)
  const isImage = mimeType.startsWith('image/')
  const isPdf = PREVIEW_PDF_EXTENSIONS.has(ext) || mimeType === 'application/pdf'

  return isHtml ? 'html' : isImage ? 'image' : isPdf ? 'pdf' : binary ? 'binary' : 'text'
}

interface PreviewFileTargetDeps {
  hermesHome: string
  resolveHermesCwd: () => string
  fileExists: (value: string) => boolean
  directoryExists: (value: string) => boolean
}

export function createPreviewTargetResolver({
  hermesHome,
  resolveHermesCwd,
  fileExists,
  directoryExists
}: PreviewFileTargetDeps) {
  /** Markdown hrefs must percent-encode spaces (`/my%20notes/x.md`), but the
   *  on-disk path is the decoded form. When the raw path misses, retry decoded
   *  so chat links to paths with spaces still open in the preview rail. */
  function decodedPathIfMissing(resolvedPath) {
    if (!/%[0-9a-fA-F]{2}/.test(resolvedPath)) {
      return null
    }

    let decoded

    try {
      decoded = decodeURIComponent(resolvedPath)
    } catch {
      return null
    }

    return decoded !== resolvedPath ? decoded : null
  }

  async function previewFileTarget(rawTarget, baseDir) {
    const raw = String(rawTarget || '').trim()
    const base = baseDir ? path.resolve(expandUserPath(baseDir)) : resolveHermesCwd()

    // A plain backend target is a WSL/POSIX path; bridge it to a Windows-
    // accessible form before resolving so the existence checks below (and the
    // final read) hit the real file rather than a drive-relative C:\home\... miss.
    let resolved = resolveRequestedPathForIpc(resolvePreviewTargetPath(raw, expandUserPath), {
      baseDir: base,
      purpose: 'Preview target'
    })

    // Attachment references stored in chat history are frequently HOME-relative
    // (e.g. "AppData/Local/hermes/attachments/foo.xlsx" on Windows, or
    // ".hermes/attachments/foo.xlsx" elsewhere) rather than relative to the
    // agent's working directory. The primary resolution above only tries
    // `base` (the working dir), so such a ref never exists there and the
    // preview/download 404s even though the file is present on disk (#115609).
    if (!fileExists(resolved) && !directoryExists(resolved)) {
      for (const candidate of homeRelativeAttachmentCandidates(raw, app.getPath('home'), hermesHome)) {
        if (fileExists(candidate)) {
          resolved = candidate

          break
        }
      }
    }

    // Markdown hrefs must percent-encode spaces (`/my%20notes/x.md`), but the
    // on-disk path is the decoded form. When the encoded path misses, retry the
    // decoded form so chat links to paths with spaces still open in the preview
    // rail (#102782) — before the directory/missing classification below, so a
    // decoded target is typed by what it actually is.
    if (!fileExists(resolved) && !directoryExists(resolved)) {
      const decoded = decodedPathIfMissing(resolved)

      if (decoded && (fileExists(decoded) || directoryExists(decoded))) {
        resolved = decoded
      }
    }

    // A directory is not a preview (#101683). Overloading it as
    // `<dir>/index.html` made a directory without one classify as missing, and
    // the renderer's blind fallback then fabricated a broken text-preview tab.
    // Answer with a typed non-previewable result so the card can offer the
    // native folder action, and a typed `missing` result so a dead link reports
    // instead of previewing.
    if (directoryExists(resolved)) {
      return {
        kind: 'file',
        label: path.basename(resolved) || resolved,
        path: resolved,
        previewKind: 'directory',
        source: raw,
        url: pathToFileURL(resolved).toString()
      }
    }

    if (!fileExists(resolved)) {
      return {
        kind: 'file',
        label: path.basename(resolved) || raw,
        path: resolved,
        previewKind: 'missing',
        source: raw,
        url: pathToFileURL(resolved).toString()
      }
    }

    const ext = path.extname(resolved).toLowerCase()

    ;({ resolvedPath: resolved } = await resolveReadableFileForIpc(resolved, { purpose: 'Preview target' }))

    const mimeType = mimeTypeForPath(resolved)
    const metadata = previewFileMetadata(resolved, mimeType)
    const previewKind = filePreviewKind(ext, mimeType, metadata.binary)

    return {
      binary: metadata.binary,
      byteSize: metadata.byteSize,
      kind: 'file',
      large: metadata.large,
      label: path.basename(resolved),
      language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
      mimeType,
      path: resolved,
      previewKind,
      source: raw,
      url: pathToFileURL(resolved).toString()
    }
  }

  async function normalizePreviewTarget(rawTarget, baseDir) {
    const raw = String(rawTarget || '').trim()

    if (!raw) {
      return null
    }

    try {
      if (/^https?:\/\//i.test(raw)) {
        return previewHttpUrlTarget(raw)
      }

      return await previewFileTarget(raw, baseDir)
    } catch {
      return null
    }
  }

  return normalizePreviewTarget
}
