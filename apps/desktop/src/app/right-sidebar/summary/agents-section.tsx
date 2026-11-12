import { useMemo } from 'react'

import { openSubagentPanel } from '@/app/agents/subagent-panel'
import { panelRowRunning, panelRowStatus, subagentPanelRows } from '@/app/agents/subagent-panel-rows'
import { Button } from '@/components/ui/button'
import { SubagentAvatar } from '@/components/ui/subagent-avatar'
import { useI18n } from '@/i18n'
import { subagentDisplayName } from '@/lib/subagent-identity'
import { useSessionSlice } from '@/lib/use-session-slice'
import { $subagentsBySession } from '@/store/subagents'

import { summaryAgentCounts, type SummaryDelegation, summaryDelegations } from './session-activity'
import { SummarySection } from './summary-section'
import type { SummarySession } from './use-summary-session'

export function AgentsSection({ history, session }: { history: SummaryDelegation[]; session: SummarySession }) {
  const { t } = useI18n()
  const live = useSessionSlice($subagentsBySession, session.runtimeId)
  const groups = useMemo(() => summaryDelegations(history, live), [history, live])
  const counts = summaryAgentCounts(groups)
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const rows = subagentPanelRows(groups)
  const runningRows = rows.filter(panelRowRunning)
  const source = { parentRuntimeId: session.runtimeId, storedSessionId: session.storedId, owner: session.owner }

  if (!total) {
    return null
  }

  const labels = [
    counts.running && t.summary.agents.running(counts.running),
    counts.completed && t.summary.agents.completed(counts.completed),
    counts.failed && t.summary.agents.failed(counts.failed),
    counts.dispatched && t.summary.agents.dispatched(counts.dispatched)
  ].filter(Boolean)

  return (
    <SummarySection title={t.summary.agents.title}>
      <Button
        aria-label={`${t.summary.agents.viewAll} · ${labels.join(' · ')}`}
        className="w-full min-w-0 justify-start px-0"
        data-slot="summary-agents-overview"
        onClick={() => openSubagentPanel(source)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
          {rows.slice(-4).map(item => (
            <SubagentAvatar
              className="size-4 shrink-0"
              key={item.key}
              parentSessionId={session.storedId || session.runtimeId}
              task={item.row}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{labels.join(' · ')}</span>
      </Button>
      {runningRows.slice(0, 5).map(item => (
        <Button
          className="w-full min-w-0 justify-start px-0"
          key={item.key}
          onClick={() => openSubagentPanel({ ...source, toolCallId: item.callId, row: item.row })}
          size="sm"
          type="button"
          variant="ghost"
        >
          <SubagentAvatar
            className="size-4 shrink-0"
            parentSessionId={session.storedId || session.runtimeId}
            task={item.row}
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {subagentDisplayName(item.row, t.assistant.tool.delegatedTask)}
          </span>
          <span className="shrink-0 text-[length:var(--aino-text-caption)] text-(--ui-text-secondary)">
            {panelRowStatus(item, t.summary.agents)}
          </span>
        </Button>
      ))}
      {runningRows.length > 0 && (
        <Button className="mt-2" onClick={() => openSubagentPanel(source)} size="inline" type="button" variant="text">
          {t.summary.agents.viewAll}
        </Button>
      )}
    </SummarySection>
  )
}
