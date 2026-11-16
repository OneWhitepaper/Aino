import { useId, useMemo, useState } from 'react'

import { openSubagentPanel } from '@/app/agents/subagent-panel'
import {
  panelRowRunning,
  panelRowStatus,
  type SubagentPanelRow,
  subagentPanelRows
} from '@/app/agents/subagent-panel-rows'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
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
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const historyId = useId()
  const live = useSessionSlice($subagentsBySession, session.runtimeId)
  const groups = useMemo(() => summaryDelegations(history, live), [history, live])
  const counts = summaryAgentCounts(groups)
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const rows = subagentPanelRows(groups)

  const needsAttention = (item: SubagentPanelRow) =>
    panelRowRunning(item) || item.row.status === 'failed' || item.row.status === 'interrupted'

  const currentRows = rows.filter(needsAttention)
  const historyRows = rows.filter(item => !needsAttention(item))

  const visibleRows = [
    ...currentRows.filter(panelRowRunning),
    ...currentRows.filter(item => !panelRowRunning(item))
  ].slice(0, 5)

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

  const renderRow = (item: SubagentPanelRow) => (
    <Button
      className="w-full min-w-0 justify-start"
      data-slot="summary-resource-row"
      key={item.key}
      onClick={() => openSubagentPanel({ ...source, toolCallId: item.callId, row: item.row })}
      size="sm"
      type="button"
      variant="ghost"
    >
      <SubagentAvatar
        className="size-[21px] shrink-0"
        parentSessionId={session.storedId || session.runtimeId}
        task={item.row}
      />
      <span className="min-w-0 flex-1 truncate text-left">
        {subagentDisplayName(item.row, t.assistant.tool.delegatedTask)}
      </span>
      <span className="shrink-0 text-(--ui-text-tertiary)" data-slot="summary-row-status">
        {panelRowStatus(item, t.summary.agents)}
      </span>
      <Codicon aria-hidden name="chevron-right" size="0.75rem" />
    </Button>
  )

  return (
    <SummarySection
      action={
        <Button
          aria-label={`${t.summary.agents.viewAll} · ${labels.join(' · ')}`}
          data-slot="summary-section-action"
          onClick={() => openSubagentPanel(source)}
          size="inline"
          type="button"
          variant="text"
        >
          {t.summary.agents.viewAll}
        </Button>
      }
      title={t.summary.agents.title}
    >
      {visibleRows.map(renderRow)}
      {historyRows.length > 0 && (
        <div data-slot="summary-history">
          <Button
            aria-controls={historyId}
            aria-expanded={historyExpanded}
            className="w-full justify-start"
            data-slot="summary-disclosure"
            onClick={() => setHistoryExpanded(value => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Codicon aria-hidden name={historyExpanded ? 'chevron-down' : 'chevron-right'} />
            {t.summary.agents.history(historyRows.length)}
          </Button>
          {historyExpanded && <div id={historyId}>{historyRows.map(renderRow)}</div>}
        </div>
      )}
    </SummarySection>
  )
}
