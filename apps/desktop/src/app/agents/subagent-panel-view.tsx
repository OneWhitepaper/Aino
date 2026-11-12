import './subagent-panel.css'

import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { SubagentControls } from '@/app/chat/composer/status-stack/subagent-controls'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { $workspaceMode, $workspaceOwnerKey } from '@/components/pane-shell/workspace-scope'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { SubagentAvatar } from '@/components/ui/subagent-avatar'
import { useI18n } from '@/i18n'
import { displayModelName } from '@/lib/model-status-label'
import { subagentDisplayName } from '@/lib/subagent-identity'
import { useSessionSlice } from '@/lib/use-session-slice'
import { collaborationOwnerKey } from '@/store/collaboration-capsule-model'
import { knownOwnerForSession } from '@/store/session-states'
import { $subagentsBySession } from '@/store/subagents'
import { resolveToolSessionScope } from '@/store/tool-session'

import { summaryDelegations } from '../right-sidebar/summary/session-activity'
import { useSummaryContent } from '../right-sidebar/summary/use-summary-content'
import { type SummarySession, useSummarySession } from '../right-sidebar/summary/use-summary-session'

import { $subagentPanelSelection, subagentPanelSourceKey } from './subagent-panel'
import {
  panelRowRunning,
  panelRowStatus,
  selectedPanelRow,
  type SubagentPanelRow,
  subagentPanelRows
} from './subagent-panel-rows'
import { SubagentPanelTranscript } from './subagent-panel-transcript'

function SubagentDetail({ item, session }: { item: SubagentPanelRow; session: SummarySession }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const { row } = item
  const running = panelRowRunning(item)
  const native = useSessionSlice($subagentsBySession, session.runtimeId)
  const childId = row.subagentId ?? row.id

  const controllable = Boolean(
    running &&
    session.runtimeId &&
    session.owner &&
    collaborationOwnerKey(knownOwnerForSession(session.runtimeId)) === collaborationOwnerKey(session.owner) &&
    native.some(task => task.id === childId && !task.id.startsWith('delegate-tool:'))
  )

  const activity = row.activity.length > 0 && (
    <ol aria-label={t.agents.extendedTranscript} className="subagent-panel-activity">
      {row.activity.map((entry, index) => (
        <li key={`${row.id}:${index}`}>
          <CompactMarkdown text={entry} />
        </li>
      ))}
    </ol>
  )

  return (
    <div className="subagent-panel-detail" data-subagent-detail={row.id}>
      <div className="subagent-panel-meta">
        <span>{panelRowStatus(item, t.summary.agents)}</span>
        {row.model && <span>{displayModelName(row.model)}</span>}
      </div>
      <p className="subagent-panel-goal">{row.goal}</p>
      {(running || !row.sessionId) && activity}
      <SubagentPanelTranscript
        live={controllable}
        owner={session.owner}
        parentRuntimeId={session.runtimeId}
        row={row}
      />
      {!running && row.sessionId && activity && (
        <details className="mt-6">
          <summary className="cursor-pointer text-(--ui-text-secondary)">{t.agents.extendedTranscript}</summary>
          {activity}
        </details>
      )}
      {controllable && session.runtimeId && (
        <div className="subagent-panel-controls">
          <SubagentControls sessionId={session.runtimeId} setText={setText} subagentId={childId} text={text} />
        </div>
      )}
    </div>
  )
}

/** One tool tab follows the foreground, or an explicitly inspected capsule source. */
export function SubagentPanel() {
  const { t } = useI18n()
  const foreground = useSummarySession()
  useStore($workspaceMode)
  useStore($workspaceOwnerKey)
  const sourceKey = subagentPanelSourceKey(foreground)
  const selection = useStore($subagentPanelSelection)
  const anchored = selection?.sourceKey === sourceKey ? selection : null
  const inspection = anchored?.inspection

  const session = inspection ? {
    ...foreground,
    ...inspection,
    cwd: '',
    scope: resolveToolSessionScope(inspection.owner)
  } : foreground

  const content = useSummaryContent(session)
  const live = useSessionSlice($subagentsBySession, session.runtimeId)
  const rows = subagentPanelRows(summaryDelegations(content.delegations, live))
  const selected = anchored?.taskId ? anchored : null

  const item = selected
    ? (selectedPanelRow(rows, selected) ??
      (selected.row
        ? {
            key: selected.taskId!,
            callId: selected.toolCallId ?? '',
            row: selected.row,
            settled: false
          }
        : undefined))
    : undefined

  const name = item ? subagentDisplayName(item.row, t.assistant.tool.delegatedTask) : ''

  const sections = [
    { title: t.agents.running, rows: rows.filter(panelRowRunning) },
    {
      title: t.summary.agents.finished,
      rows: rows.filter(row => !panelRowRunning(row) && (row.settled || row.row.status !== 'dispatched'))
    },
    {
      title: t.summary.agents.status.dispatched,
      rows: rows.filter(row => !row.settled && row.row.status === 'dispatched')
    }
  ]

  return (
    <section aria-label={t.summary.agents.title} className="subagent-panel" data-slot="subagent-panel" key={sourceKey}>
      {selected ? (
        <>
          <header className="subagent-panel-header">
            <Button
              aria-label={t.common.back}
              onClick={() => $subagentPanelSelection.set(inspection && anchored
                ? { ...anchored, taskId: undefined, row: undefined, toolCallId: undefined }
                : null)}
              size="icon-sm"
              variant="ghost"
            >
              <Codicon name="arrow-left" />
            </Button>
            {item && (
              <SubagentAvatar
                className="subagent-panel-avatar"
                parentSessionId={session.storedId || session.runtimeId}
                task={item.row}
              />
            )}
            <h2>{name || t.assistant.tool.delegatedTask}</h2>
          </header>
          {item ? (
            <SubagentDetail item={item} key={`${sourceKey}:${item.key}`} session={session} />
          ) : (
            <p className="subagent-panel-empty">{t.agents.transcriptUnavailable}</p>
          )}
        </>
      ) : (
        <div className="subagent-panel-list">
          {sections
            .filter(section => section.rows.length)
            .map(section => (
              <section key={section.title}>
                <h2 className="subagent-panel-section-title">
                  {section.title} · {section.rows.length}
                </h2>
                {section.rows.map(item => (
                  <Button
                    className="subagent-panel-row"
                    key={item.key}
                    onClick={() =>
                      $subagentPanelSelection.set({
                        sourceKey,
                        ...(inspection ? { inspection } : {}),
                        taskId: item.row.id,
                        toolCallId: item.callId,
                        row: item.row
                      })
                    }
                    size="touch"
                    variant="ghost"
                  >
                    <SubagentAvatar
                      className="subagent-panel-avatar"
                      parentSessionId={session.storedId || session.runtimeId}
                      task={item.row}
                    />
                    <span className="subagent-panel-name">
                      {subagentDisplayName(item.row, t.assistant.tool.delegatedTask)}
                    </span>
                    <span className="subagent-panel-status">{panelRowStatus(item, t.summary.agents)}</span>
                    <Codicon name="chevron-right" />
                  </Button>
                ))}
              </section>
            ))}
          {!rows.length && (
            <p className="subagent-panel-empty">{content.loading ? t.summary.state.loading : t.agents.emptyDesc}</p>
          )}
          {content.error && (
            <Button onClick={() => void content.refetch()} size="sm" variant="ghost">
              {t.summary.state.retry}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
