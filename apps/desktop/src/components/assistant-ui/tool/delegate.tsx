'use client'

import { useStore } from '@nanostores/react'
import { type FC, useEffect, useMemo } from 'react'

import { openSubagentPanel, syncSubagentPanelRows } from '@/app/agents/subagent-panel'
import { useSessionView } from '@/app/chat/session-view'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { SCAFFOLD_GLYPH_CLASS, SCAFFOLD_LABEL_CLASS, SCAFFOLD_META_CLASS } from '@/components/chat/scaffold-row'
import { Button } from '@/components/ui/button'
import { SubagentAvatar } from '@/components/ui/subagent-avatar'
import { useI18n } from '@/i18n'
import { subagentDisplayName } from '@/lib/subagent-identity'
import { useSessionSlice } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { knownOwnerForSession } from '@/store/session-states'
import { $subagentsBySession, subagentsWithHistory } from '@/store/subagents'

import { type DelegateRow, delegateRowsFromCall, isDelegateRowLive, mergeDelegateRows } from './delegate-model'
import { formatDurationSeconds, type ToolPart } from './fallback-model'

interface DelegateRowViewProps {
  row: DelegateRow
  parentSessionId: string | null
  storedSessionId: string | null
  toolCallId?: string
}

/** A compact identity; inspecting it leaves the parent conversation in place. */
function DelegateRowView({ row, parentSessionId, storedSessionId, toolCallId }: DelegateRowViewProps) {
  const { t } = useI18n()
  const live = isDelegateRowLive(row.status)
  const elapsed = useElapsedSeconds(live, `delegate:${row.id}`)
  const statusLabel = t.summary.agents.status[row.status]
  const failed = row.status === 'failed' || row.status === 'interrupted'
  const name = subagentDisplayName(row, t.assistant.tool.delegatedTask)
  const metaClassName = cn(SCAFFOLD_META_CLASS, 'text-[length:var(--aino-text-caption)]')

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-2"
      data-conversation-scaffold=""
      data-delegate-status={row.status}
    >
      <Button
        className="min-w-0 justify-start font-normal"
        data-slot="delegate-open"
        onClick={() =>
          openSubagentPanel({
            parentRuntimeId: parentSessionId,
            storedSessionId,
            owner: knownOwnerForSession(parentSessionId) ?? knownOwnerForSession(storedSessionId),
            taskId: row.subagentId || row.id,
            toolCallId,
            row
          })
        }
        size="inline"
        type="button"
        variant="text"
      >
        <span className={SCAFFOLD_GLYPH_CLASS}>
          <SubagentAvatar className="size-full" parentSessionId={storedSessionId || parentSessionId} task={row} />
        </span>
        <span className={cn(SCAFFOLD_LABEL_CLASS, 'min-w-0 truncate')}>{name}</span>
        <span className={cn(metaClassName, failed && 'text-destructive')}>{statusLabel}</span>
      </Button>
      {live ? (
        <ActivityTimerText className={metaClassName} seconds={elapsed} />
      ) : row.durationSeconds !== undefined ? (
        <span className={metaClassName}>{formatDurationSeconds(row.durationSeconds)}</span>
      ) : null}
    </div>
  )
}

/**
 * A `delegate_task` call, as the fan-out it is.
 *
 * The generic tool row can only say "Delegated 2 tasks" and hand over a blob
 * of JSON — the work itself happens in child sessions the transcript never
 * sees. This lists those children instead, joining what the call dispatched to
 * what the subagent store knows about them, so a delegation reads like the
 * several agents it actually is.
 *
 * Each child retains its own identity and status; details share the panel.
 */
export const DelegateTool: FC<Pick<ToolPart, 'args' | 'result' | 'toolCallId'>> = ({ args, result, toolCallId }) => {
  const view = useSessionView()
  const sessionId = useStore(view.$runtimeId)
  const storedSessionId = useStore(view.$storedId)
  const live = useSessionSlice($subagentsBySession, sessionId)

  const rows = useMemo(
    () => mergeDelegateRows(delegateRowsFromCall(args, result, toolCallId), subagentsWithHistory(live), toolCallId),
    [args, live, result, toolCallId]
  )

  useEffect(() => {
    syncSubagentPanelRows(
      {
        parentRuntimeId: sessionId,
        storedSessionId,
        owner: knownOwnerForSession(sessionId) ?? knownOwnerForSession(storedSessionId),
        toolCallId
      },
      rows
    )
  }, [rows, sessionId, storedSessionId, toolCallId])

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="grid min-w-0 gap-(--tool-row-gap)" data-delegate-card="" data-slot="tool-block">
      {rows.map((row, index) => (
        <DelegateRowView
          key={`${toolCallId}:${index}`}
          parentSessionId={sessionId}
          row={row}
          storedSessionId={storedSessionId}
          toolCallId={toolCallId}
        />
      ))}
    </div>
  )
}
