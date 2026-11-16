import { useMemo, useState } from 'react'

import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { buildToolView } from '@/components/assistant-ui/tool/fallback-model'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { usePaneVisible } from '@/components/pane-shell/pane-visibility'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useI18n } from '@/i18n'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import type { SessionOwnerScope } from '@/store/session-request-router'

import { SubagentTranscript } from '../chat/composer/status-stack/subagent-transcript'

import { useSubagentTranscriptSource } from './subagent-transcript-source'

export interface SubagentPanelTranscriptProps {
  row: DelegateRow
  parentRuntimeId: string | null
  owner: SessionOwnerScope
  live: boolean
}

/** Read a child's existing transcript without resuming it or taking over its parent. */
export function SubagentPanelTranscript({ row, parentRuntimeId, owner, live }: SubagentPanelTranscriptProps) {
  const visible = usePaneVisible()
  const source = useSubagentTranscriptSource({ row, parentRuntimeId, owner, live, visible })

  const messages = useMemo(() => {
    const visible = toChatMessages(source.messages).filter(message => !message.hidden && message.role !== 'system')

    const first = visible[0]

    // The detail already displays the exact original instructions above it.
    return first?.role === 'user' && chatMessageText(first).trim() === row.goal.trim() ? visible.slice(1) : visible
  }, [source.messages, row.goal])

  if (!visible) {
    return null
  }

  return (
    <>
      <ReadableSubagentTranscript messages={messages} source={source} summary={row.summary} />
      <SubagentExecutionLog
        key={JSON.stringify([owner, parentRuntimeId, row.subagentId ?? row.id])}
        liveTail={source.ownerKnown && !source.unavailable && source.useLiveTail}
        owner={owner}
        parentRuntimeId={parentRuntimeId}
        row={row}
      />
    </>
  )
}

interface ReadableSubagentTranscriptProps {
  messages: ReturnType<typeof toChatMessages>
  source: ReturnType<typeof useSubagentTranscriptSource>
  summary?: string
}

function ReadableSubagentTranscript({ messages, source, summary }: ReadableSubagentTranscriptProps) {
  const { t } = useI18n()
  const result = summary ? <CompactMarkdown text={summary} /> : null

  if (!source.ownerKnown || source.unavailable) {
    return result ?? <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
  }

  if (source.useLiveTail) {
    return result
  }

  if (source.pending && !source.error) {
    return result ?? <Loader label={t.common.loading} />
  }

  if (source.error) {
    return (
      <div className="grid justify-items-start gap-2" role="status">
        {result}
        <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
        <Button disabled={source.fetching} onClick={() => void source.retry()} size="xs" variant="secondary">
          {t.common.retry}
        </Button>
      </div>
    )
  }

  if (!messages.length) {
    return (
      result ??
      (source.awaitingOutput ? (
        <Loader label={t.agents.running} />
      ) : (
        <p className="text-(--ui-text-secondary)">{t.agents.transcriptUnavailable}</p>
      ))
    )
  }

  return (
    <div className="grid min-w-0 gap-4" data-slot="subagent-panel-transcript">
      {source.hasEarlier && (
        <Button disabled={source.fetchingEarlier} onClick={() => void source.loadEarlier()} size="xs" variant="ghost">
          {t.assistant.thread.showEarlier}
        </Button>
      )}
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
                <ToolIcon className="mt-0.5 shrink-0" name={tool.icon || 'tools'} size="0.875rem" />
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

interface SubagentExecutionLogProps {
  row: DelegateRow
  parentRuntimeId: string | null
  owner: SessionOwnerScope
  liveTail: boolean
}

function SubagentExecutionLog({ row, parentRuntimeId, owner, liveTail }: SubagentExecutionLogProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  if (!liveTail && !row.activity.length) {
    return null
  }

  return (
    <details className="mt-6" onToggle={event => setExpanded(event.currentTarget.open)} open={expanded}>
      <summary className="cursor-pointer text-(--ui-text-secondary)">{t.agents.extendedTranscript}</summary>
      {expanded &&
        (liveTail ? (
          <SubagentTranscript owner={owner} sessionId={parentRuntimeId!} subagentId={row.subagentId ?? row.id} />
        ) : (
          <ol aria-label={t.agents.extendedTranscript} className="subagent-panel-activity mt-4">
            {row.activity.map((entry, index) => (
              <li key={`${row.id}:${index}`}>
                <CompactMarkdown text={entry} />
              </li>
            ))}
          </ol>
        ))}
    </details>
  )
}
