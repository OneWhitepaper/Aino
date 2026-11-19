// Pure derivation for the assistant message's "N files changed" card: fold a
// turn's file-edit tool parts into one row per file. No React/DOM.

import {
  countDiffLineStats,
  fileEditBasename,
  fileEditPath,
  inlineDiffFromResult,
  isFileEditTool,
  nativeFileDiffs,
  parseMaybeObject
} from '@/components/assistant-ui/tool/fallback-model'
import { displayPath, normalizeDisplayPath } from '@/lib/display-path'
import { comparisonPath } from '@/lib/path-compare'
import { type ToolResultMetadata, toolResultRecord } from '@/lib/tool-result-metadata'

export interface ChangedFile {
  added: number
  /** Recorded edits in execution order; these are not a net working-tree diff. */
  diffs: string[]
  /** Basename, for the row label. */
  name: string
  /** Path exactly as the tool reported it (absolute or repo-relative). */
  path: string
  removed: number
}

interface ChangedFilePart {
  toolResultMetadata?: ToolResultMetadata
  args?: unknown
  result?: unknown
  toolName?: unknown
  type?: unknown
}

/** Keep repo paths compact without changing the target passed to review. */
export function changedFileDisplayPath(path: string, cwd: string): string {
  const normalized = normalizeDisplayPath(path)
  const root = normalizeDisplayPath(cwd)
  const prefix = root.endsWith('/') ? root : `${root}/`

  if (root && comparisonPath(normalized).startsWith(comparisonPath(prefix))) {
    return normalized.slice(prefix.length)
  }

  const displayed = displayPath(normalized)
  const segments = displayed.split('/')

  // Cache and external paths can contain long installation/account prefixes.
  // Their immediate parents identify the file; the tooltip keeps the full path.
  return segments.length > 4 ? `…/${segments.slice(-3).join('/')}` : displayed
}

/**
 * One row per file the turn edited, in first-touched order, with the +/- of
 * every edit to that file summed. Only landed edits with a diff count: a call
 * still running has no result, and a failed one changed nothing.
 */
export function deriveChangedFiles(parts: readonly unknown[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()

  for (const raw of parts) {
    const part = (raw ?? {}) as ChangedFilePart

    if (part.type !== 'tool-call' || typeof part.toolName !== 'string' || !isFileEditTool(part.toolName)) {
      continue
    }

    const result = toolResultRecord(part)
    const diff = inlineDiffFromResult(result)

    if (!diff) {
      continue
    }

    const native = nativeFileDiffs(result)
    const files = native.length ? native : [{ path: fileEditPath(parseMaybeObject(part.args), result), diff }]

    for (const { path, diff: fileDiff } of files) {
      if (!path) {
        continue
      }

      const stats = countDiffLineStats(fileDiff)
      const existing = byPath.get(path)

      if (existing) {
        existing.added += stats.added
        existing.removed += stats.removed
        existing.diffs.push(fileDiff)
      } else {
        byPath.set(path, {
          added: stats.added,
          diffs: [fileDiff],
          name: fileEditBasename(path),
          path,
          removed: stats.removed
        })
      }
    }
  }

  return [...byPath.values()]
}
