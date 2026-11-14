import { atom } from 'nanostores'

import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { setTreePaneParked } from '@/components/pane-shell/tree/parked-panes'
import { $layoutTree, restoreTreePane } from '@/components/pane-shell/tree/store'
import { $workspaceMode, $workspaceOwnerKey, workspaceScopeKey } from '@/components/pane-shell/workspace-scope'
import { collaborationOwnerKey } from '@/store/collaboration-capsule-model'
import { sessionOwnerIsKnown } from '@/store/session-owner-resolution'
import type { SessionOwnerScope } from '@/store/session-request-router'
import { $toolSession, type ToolSession } from '@/store/tool-session'

export const SUBAGENT_PANEL_ID = 'subagents'

// The standing contribution can restore a saved tab, but never inserts itself
// into a new layout merely because a child was dispatched in the background.
$layoutTree.subscribe(tree => setTreePaneParked(SUBAGENT_PANEL_ID, !tree || !findGroupOfPane(tree, SUBAGENT_PANEL_ID)))

export interface SubagentPanelIntent {
  parentRuntimeId: string | null
  storedSessionId?: string | null
  owner?: SessionOwnerScope
  taskId?: string
  toolCallId?: string
  row?: DelegateRow
  /** A capsule may inspect another parent without activating its hidden chat. */
  inspection?: Pick<ToolSession, 'owner' | 'runtimeId' | 'storedId'>
  anchorSourceKey?: string
}

interface SubagentPanelSelection {
  sourceKey: string
  taskId?: string
  toolCallId?: string
  row?: DelegateRow
  inspection?: Pick<ToolSession, 'owner' | 'runtimeId' | 'storedId'>
}

export const $subagentPanelSelection = atom<SubagentPanelSelection | null>(null)

/** This is presentation state, scoped to the existing tool-session authority. */
export function subagentPanelSourceKey(session: Pick<ToolSession, 'owner' | 'storedId' | 'runtimeId' | 'sourceKey'>) {
  return JSON.stringify([
    collaborationOwnerKey(session.owner),
    session.storedId ?? session.runtimeId,
    session.sourceKey,
    workspaceScopeKey($workspaceMode.get(), $workspaceOwnerKey.get())
  ])
}

/** Explicit inspection never activates or resumes the child, or opens a window. */
export function openSubagentPanel(intent: SubagentPanelIntent): boolean {
  const session = $toolSession.get()

  const matches = intent.inspection
    ? intent.anchorSourceKey === subagentPanelSourceKey(session) &&
      sessionOwnerIsKnown(intent.inspection.owner) &&
      Boolean(intent.inspection.runtimeId || intent.inspection.storedId)
    : (intent.parentRuntimeId && intent.parentRuntimeId === session.runtimeId) ||
      (intent.storedSessionId && intent.storedSessionId === session.storedId)

  if (
    !matches ||
    (!intent.inspection &&
      intent.owner !== undefined &&
      collaborationOwnerKey(intent.owner) !== collaborationOwnerKey(session.owner))
  ) {
    return false
  }

  $subagentPanelSelection.set({
    sourceKey: subagentPanelSourceKey(session),
    taskId: intent.taskId ?? intent.row?.subagentId ?? intent.row?.id,
    toolCallId: intent.toolCallId,
    row: intent.row,
    ...(intent.inspection ? { inspection: { ...intent.inspection } } : {})
  })
  setTreePaneParked(SUBAGENT_PANEL_ID, false)
  restoreTreePane(SUBAGENT_PANEL_ID)

  return true
}

/** A dispatch receipt can identify a row after the user has already inspected its placeholder. */
export function syncSubagentPanelRows(intent: SubagentPanelIntent, rows: readonly DelegateRow[]): boolean {
  const session = $toolSession.get()
  const selection = $subagentPanelSelection.get()
  const callId = intent.toolCallId
  const source = selection?.inspection ?? session

  const matches =
    (intent.parentRuntimeId && intent.parentRuntimeId === source.runtimeId) ||
    (intent.storedSessionId && intent.storedSessionId === source.storedId)

  if (
    !matches ||
    !callId ||
    !selection?.taskId ||
    selection.sourceKey !== subagentPanelSourceKey(session) ||
    selection.toolCallId !== callId ||
    (intent.owner !== undefined && collaborationOwnerKey(intent.owner) !== collaborationOwnerKey(source.owner))
  ) {
    return false
  }

  const row = rows.find((candidate, index) => {
    if (candidate.id === selection.taskId || candidate.subagentId === selection.taskId) {
      return true
    }

    // Only the exact, declared tool-call index can promote a pending placeholder.
    // Equal task descriptions and equal batch sizes carry no identity.
    return (
      selection.row !== undefined &&
      selection.taskId === selection.row.id &&
      [`${callId}:${index}`, `delegate-tool:${callId}:${index}`].includes(selection.row.id)
    )
  })

  if (!row || row === selection.row) {
    return false
  }

  $subagentPanelSelection.set({ ...selection, taskId: row.subagentId || row.id, row })

  return true
}
