'use client'

import { useStore } from '@nanostores/react'
import { type FC, useMemo, useState } from 'react'

import { SubagentControls } from '@/app/chat/composer/status-stack/subagent-controls'
import { useSessionView } from '@/app/chat/session-view'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import {
  SCAFFOLD_GLYPH_CLASS,
  SCAFFOLD_LABEL_CLASS,
  SCAFFOLD_META_CLASS,
  ScaffoldRow
} from '@/components/chat/scaffold-row'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { displayModelName } from '@/lib/model-status-label'
import { useSessionSlice } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $subagentsBySession } from '@/store/subagents'
import { openSessionInNewWindow } from '@/store/windows'

import { type DelegateRow, delegateRowsFromCall, isDelegateRowLive, mergeDelegateRows } from './delegate-model'
import { formatDurationSeconds, type ToolPart } from './fallback-model'

interface DelegateRowViewProps {
  row: DelegateRow
  parentSessionId: string | null
}

/** One quiet status line per child; its existing activity and controls open on demand. */
function DelegateRowView({ row, parentSessionId }: DelegateRowViewProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [steerText, setSteerText] = useState('')
  const { sessionId } = row
  const live = isDelegateRowLive(row.status)
  const elapsed = useElapsedSeconds(live, `delegate:${row.id}`)
  const statusLabel = t.summary.agents.status[row.status]
  const failed = row.status === 'failed' || row.status === 'interrupted'

  // Only a child that reported its own session id has somewhere to go.
  const open = sessionId ? () => void openSessionInNewWindow(sessionId, { watch: true }) : undefined

  return (
    <div className="grid min-w-0 max-w-full gap-1" data-conversation-scaffold="" data-delegate-status={row.status}>
      <ScaffoldRow
        onToggle={() => setExpanded(value => !value)}
        open={expanded}
        trailing={
          live ? (
            <ActivityTimerText className={SCAFFOLD_META_CLASS} seconds={elapsed} />
          ) : row.durationSeconds !== undefined ? (
            <span className={SCAFFOLD_META_CLASS}>{formatDurationSeconds(row.durationSeconds)}</span>
          ) : undefined
        }
      >
        <span className={SCAFFOLD_GLYPH_CLASS}>
          <Codicon name="agent" size="0.75rem" />
        </span>
        <span className={cn(SCAFFOLD_LABEL_CLASS, 'min-w-0 truncate')}>{row.goal}</span>
        <span className={cn(SCAFFOLD_META_CLASS, failed && 'text-destructive')}>{statusLabel}</span>
      </ScaffoldRow>
      {expanded && (
        <div className="grid min-w-0 gap-2 pl-5" data-slot="delegate-detail">
          <p className={cn(SCAFFOLD_LABEL_CLASS, 'whitespace-pre-wrap break-words')}>{row.goal}</p>
          {row.model && <span className={SCAFFOLD_META_CLASS}>{displayModelName(row.model)}</span>}
          {row.activity.map((text, index) => (
            <p className={cn(SCAFFOLD_LABEL_CLASS, 'whitespace-pre-wrap break-words')} key={`${row.id}:${index}`}>
              {text}
            </p>
          ))}
          {open && (
            <Button className="justify-self-start" onClick={open} size="inline" type="button" variant="text">
              <Codicon name="link-external" />
              {t.profiles.openInNewWindow}
            </Button>
          )}
          {live && sessionId && parentSessionId && (
            <SubagentControls sessionId={parentSessionId} setText={setSteerText} subagentId={row.id} text={steerText} />
          )}
        </div>
      )}
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
 * Each child retains its own disclosure so a fan-out never hides which worker
 * is still running or failed behind a rotating shared status.
 */
export const DelegateTool: FC<Pick<ToolPart, 'args' | 'result' | 'toolCallId'>> = ({ args, result, toolCallId }) => {
  const sessionId = useStore(useSessionView().$runtimeId)
  const live = useSessionSlice($subagentsBySession, sessionId)

  const rows = useMemo(
    () => mergeDelegateRows(delegateRowsFromCall(args, result, toolCallId), live, toolCallId),
    [args, live, result, toolCallId]
  )

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="grid min-w-0 gap-(--tool-row-gap)" data-delegate-card="" data-slot="tool-block">
      {rows.map((row, index) => (
        <DelegateRowView key={`${toolCallId}:${index}`} parentSessionId={sessionId} row={row} />
      ))}
    </div>
  )
}
