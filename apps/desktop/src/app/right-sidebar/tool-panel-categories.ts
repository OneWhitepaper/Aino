import type { PreviewTab } from '@/store/preview'

export type ToolPanelCategory = 'browser' | 'files' | 'terminal' | 'review' | 'collaboration'

export const TOOL_PANEL_CATEGORIES: readonly ToolPanelCategory[] = [
  'browser',
  'files',
  'terminal',
  'review',
  'collaboration'
]

/** Categories describe the existing pane, never a second browser/file instance. */
export function toolPanelCategory(paneId: string, previews: readonly PreviewTab[]): ToolPanelCategory | null {
  const fixed: Record<string, ToolPanelCategory> = {
    files: 'files',
    terminal: 'terminal',
    review: 'review',
    subagents: 'collaboration'
  }

  if (fixed[paneId]) {
    return fixed[paneId]
  }

  if (paneId.startsWith('preview-tile:')) {
    const preview = previews.find(tab => `preview-tile:${tab.id}` === paneId)

    return preview ? (preview.target.kind === 'url' ? 'browser' : 'files') : null
  }

  return null
}

/** Prefer the active instance, then the last retained tab in that category. */
export function retainedToolCategoryPane(
  category: ToolPanelCategory,
  paneIds: readonly string[],
  activeId: string,
  previews: readonly PreviewTab[]
): string | undefined {
  if (paneIds.includes(activeId) && toolPanelCategory(activeId, previews) === category) {
    return activeId
  }

  return paneIds.findLast(id => toolPanelCategory(id, previews) === category)
}
