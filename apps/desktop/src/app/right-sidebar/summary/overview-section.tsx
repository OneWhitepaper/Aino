import type { SessionSummaryPoint as SummaryPoint } from '@hermes/shared'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { notifyError } from '@/store/notifications'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import { $sessionStates } from '@/store/session-states'
import { requestScrollToBottom } from '@/store/thread-scroll'

import { revealSummaryMessage } from './message-navigation'
import { SummarySection } from './summary-section'
import { useSessionSummary } from './use-session-summary'
import type { useSummaryContent } from './use-summary-content'
import type { SummarySession } from './use-summary-session'

const STATUS_ICONS: Record<SessionDotState | 'interrupted', string> = {
  background: 'run-all',
  draft: 'circle-outline',
  idle: 'circle-filled',
  interrupted: 'debug-pause',
  'needs-input': 'comment-discussion',
  stalled: 'watch',
  unread: 'circle-filled',
  working: 'loading'
}

interface OverviewSectionProps {
  content: ReturnType<typeof useSummaryContent>
  session: SummarySession
}

function SummaryPoints({ label, points, session }: { label: string; points: SummaryPoint[]; session: SummarySession }) {
  const { t } = useI18n()
  const [opening, setOpening] = useState<number | null>(null)

  if (!points.length) {
    return null
  }

  const reveal = async (messageId: number) => {
    setOpening(messageId)

    try {
      if (!(await revealSummaryMessage(session, messageId))) {
        notifyError(new Error(t.summary.overview.sourceUnavailable), t.summary.overview.sourceUnavailable)
      }
    } catch (error) {
      notifyError(error, t.summary.overview.sourceUnavailable)
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="grid gap-1">
      <h3 className="text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">{label}</h3>
      <ul className="grid gap-2">
        {points.map((point, index) => (
          <li className="break-words" key={`${index}:${point.text}`}>
            <span>{point.text}</span>
            <span className="ml-1 inline-flex gap-1">
              {point.message_ids.map((id, sourceIndex) => (
                <Button
                  aria-label={t.summary.overview.source(sourceIndex + 1)}
                  disabled={opening !== null}
                  key={id}
                  onClick={() => void reveal(id)}
                  size="inline"
                  type="button"
                  variant="text"
                >
                  [{sourceIndex + 1}]
                </Button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function OverviewSection({ content, session }: OverviewSectionProps) {
  const { t, locale } = useI18n()
  const copy = t.summary.overview
  const summary = useSessionSummary(session, content, locale)

  const dot = useStoreSelector($sessionDotStateById, states =>
    session.storedId ? states[session.storedId] : undefined
  )

  const interrupted = useStoreSelector($sessionStates, states =>
    Boolean(session.runtimeId && states[session.runtimeId]?.interrupted)
  )

  const status =
    dot === 'needs-input'
      ? dot
      : session.busy || summary.backendBusy
        ? dot === 'stalled'
          ? dot
          : 'working'
        : interrupted
          ? 'interrupted'
          : (dot ?? (content.historyReady ? 'idle' : 'draft'))

  const hasWork = Boolean(content.outputs.length || content.todos.length || content.delegations.length)
  const snapshot = summary.summary

  const updated = snapshot
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(snapshot.updated_at * 1000)
    : ''

  return (
    <SummarySection
      action={
        (summary.eligible || Boolean(summary.error)) && (
          <Button
            aria-label={copy.refresh}
            disabled={!summary.canRefresh}
            onClick={() => void summary.refresh()}
            size="inline"
            type="button"
            variant="text"
          >
            <Codicon name="refresh" />
          </Button>
        )
      }
      title={copy.title}
    >
      <div className="grid gap-3">
        <div aria-live="polite" className="flex items-center gap-2" role="status">
          <Codicon name={STATUS_ICONS[status]} spinning={status === 'working'} />
          <span className="min-w-0 flex-1">{copy.status[status]}</span>
          {status === 'needs-input' && (
            <Button onClick={() => requestScrollToBottom(session.runtimeId)} size="inline" type="button" variant="text">
              {copy.viewRequest}
            </Button>
          )}
        </div>
        {snapshot ? (
          <>
            <SummaryPoints
              label={copy.objective}
              points={snapshot.objective ? [snapshot.objective] : []}
              session={session}
            />
            <SummaryPoints label={copy.completed} points={snapshot.completed} session={session} />
            <SummaryPoints label={copy.conclusions} points={snapshot.conclusions} session={session} />
            <SummaryPoints label={copy.openQuestions} points={snapshot.open_questions} session={session} />
            <p className="text-[length:var(--aino-text-caption)] text-(--ui-text-tertiary)">
              {copy.updated(updated)}
              {summary.stale ? ` · ${copy.stale}` : ''}
              {snapshot.coverage && snapshot.coverage !== 'full' && (
                <span className="mt-1 block">{copy.coverage[snapshot.coverage]}</span>
              )}
            </p>
          </>
        ) : (
          !summary.error && (
            <p className="text-(--ui-text-tertiary)">
              {summary.loading || content.loading
                ? t.summary.state.loading
                : summary.eligible
                  ? copy.pending
                  : hasWork
                    ? copy.resourcesAvailable
                    : copy.empty}
            </p>
          )
        )}
        {summary.loading && snapshot && <p className="text-(--ui-text-tertiary)">{copy.updating}</p>}
        {Boolean(summary.error) && (
          <div className="flex items-center gap-2 text-(--ui-text-tertiary)" role="alert">
            <span className="min-w-0 flex-1">{summary.errorCode === 'input_limit' ? copy.tooLong : copy.failed}</span>
            {summary.errorCode !== 'input_limit' && (
              <Button
                disabled={!summary.canRefresh}
                onClick={() => void summary.refresh()}
                size="inline"
                type="button"
                variant="text"
              >
                {t.summary.state.retry}
              </Button>
            )}
          </div>
        )}
      </div>
    </SummarySection>
  )
}
