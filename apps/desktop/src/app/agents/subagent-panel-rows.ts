import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import type { Translations } from '@/i18n'

import type { SummaryDelegation } from '../right-sidebar/summary/session-activity'

export interface SubagentPanelRow {
  key: string
  callId: string
  row: DelegateRow
  settled: boolean
}

export function subagentPanelRows(groups: readonly SummaryDelegation[]): SubagentPanelRow[] {
  return groups.flatMap(group =>
    group.rows.map(row => ({
      key: JSON.stringify([group.id, row.id]),
      callId: group.id,
      row,
      settled: Boolean(group.completion)
    }))
  )
}

export const panelRowRunning = ({ row, settled }: SubagentPanelRow) =>
  !settled && (row.status === 'running' || row.status === 'queued')

export function panelRowStatus(item: SubagentPanelRow, copy: Translations['summary']['agents']) {
  return item.settled && ['running', 'queued', 'dispatched'].includes(item.row.status)
    ? copy.finished
    : copy.status[item.row.status]
}

/** Receipts and child ids are identities; equal task text never is. */
export function selectedPanelRow(
  rows: SubagentPanelRow[],
  selection: { taskId?: string; toolCallId?: string; row?: DelegateRow }
): SubagentPanelRow | undefined {
  return rows.find(
    item =>
      [item.row.id, item.row.subagentId].some(id => id && id === selection.taskId) &&
      // A native child can arrive before its persisted tool receipt. Its id is
      // already exact; only call-index placeholders need the batch constraint.
      (item.row.subagentId === selection.taskId || !selection.toolCallId || item.callId === selection.toolCallId)
  )
}
