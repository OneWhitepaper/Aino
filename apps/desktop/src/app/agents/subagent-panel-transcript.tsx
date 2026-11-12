import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { getLatestSessionMessages } from '@/api/sessions'
import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { buildToolView } from '@/components/assistant-ui/tool/fallback-model'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { sessionOwnerIsKnown } from '@/store/session-owner-resolution'
import { profileScopeForSessionOwner, type SessionOwnerScope } from '@/store/session-request-router'

import { SubagentTranscript } from '../chat/composer/status-stack/subagent-transcript'

export interface SubagentPanelTranscriptProps {
  row: DelegateRow
  parentRuntimeId: string | null
  owner: SessionOwnerScope
  live: boolean
}

/** Read a child's existing transcript without resuming it or taking over its parent. */
export function SubagentPanelTranscript({ row, parentRuntimeId, owner, live }: SubagentPanelTranscriptProps) {
  const { t } = useI18n()
  const visible = usePaneVisible()
  const ownerKnown = sessionOwnerIsKnown(owner)
  const scope = profileScopeForSessionOwner(owner)
  const useLiveTail = live && Boolean(parentRuntimeId)
  const liveSource = JSON.stringify([owner, parentRuntimeId, row.subagentId ?? row.id])
  const [expandedSource, setExpandedSource] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['subagent-panel-transcript', scope, row.sessionId],
    enabled: visible && ownerKnown && Boolean(row.sessionId) && !useLiveTail,
    queryFn: () => getLatestSessionMessages(row.sessionId!, scope, { passive: true }),
    refetchInterval: live && visible && !useLiveTail ? 2000 : false,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 60_000,
    staleTime: 0
  })

  const messages = useMemo(() => {
    const visible = toChatMessages(query.data?.messages ?? []).filter(
      message => !message.hidden && message.role !== 'system'
    )

    const first = visible[0]

    // The detail already displays the exact original instructions above it.
    return first?.role === 'user' && chatMessageText(first).trim() === row.goal.trim() ? visible.slice(1) : visible
  }, [query.data, row.goal])

  if (!visible) {
    return null
  }

  if (!ownerKnown || (!row.sessionId && !useLiveTail)) {
    return <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
  }

  if (useLiveTail) {
    return (
      <details key={liveSource} onToggle={event => setExpandedSource(event.currentTarget.open ? liveSource : null)}>
        <summary className="cursor-pointer text-(--ui-text-secondary)">{t.agents.extendedTranscript}</summary>
        {expandedSource === liveSource && (
          <SubagentTranscript owner={owner} sessionId={parentRuntimeId!} subagentId={row.subagentId ?? row.id} />
        )}
      </details>
    )
  }

  if (query.isPending) {
    return <Loader label={t.common.loading} />
  }

  if (query.isError) {
    return (
      <div className="grid justify-items-start gap-2" role="status">
        <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
        <Button
          disabled={!visible || query.isFetching}
          onClick={() => void query.refetch()}
          size="xs"
          variant="secondary"
        >
          {t.common.retry}
        </Button>
      </div>
    )
  }

  if (!messages.length) {
    return <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
  }

  return (
    <div className="grid min-w-0 gap-4" data-slot="subagent-panel-transcript">
      {messages.map(message => (
        <div className="grid min-w-0 gap-2" data-subagent-message-role={message.role} key={message.id}>
          {message.parts.map((part, index) => {
            const key = `${message.id}:${index}`

            if (part.type === 'text' || part.type === 'reasoning') {
              return <CompactMarkdown key={key} text={part.text} />
            }

            const tool = part.type === 'tool-call' ? buildToolView(part, '') : null

            return tool ? (
              <div className="flex min-w-0 items-start gap-2 text-(--ui-text-secondary)" key={key}>
                <Codicon className="mt-0.5 shrink-0" name={tool.icon || 'tools'} size="0.875rem" />
                <div className="min-w-0">
                  <p>{tool.title}</p>
                  {tool.subtitle && <p className="break-words text-(--ui-text-tertiary)">{tool.subtitle}</p>}
                </div>
              </div>
            ) : null
          })}
        </div>
      ))}
    </div>
  )
}
