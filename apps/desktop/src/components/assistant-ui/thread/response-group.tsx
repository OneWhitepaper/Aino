import { ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { type ComponentProps, createContext, type ReactNode, useContext, useMemo } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { type ToolPart, toolPreviewOutcome } from '@/components/assistant-ui/tool/fallback-model'
import { formatElapsed } from '@/components/chat/activity-timer'
import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { useI18n } from '@/i18n'
import { isCardTool, isFileEditTool } from '@/lib/tool-render-class'
import { $toolDisclosureOpen, setToolDisclosureOpen } from '@/store/tool-view'

import { contentHasVisibleText, messageContentText, PROCESS_NOTIFICATION_RE } from './content'

interface GroupMessage {
  role: string
  content: unknown
  metadata?: { custom?: Record<string, unknown> }
}

/** Background deliveries continue the response without becoming human prompts. */
export function responseMessageRole(message: GroupMessage): string {
  const custom = message.metadata?.custom

  const background =
    message.role === 'system'
      ? Boolean(custom?.asyncResult || custom?.asyncResultKind)
      : message.role === 'user' && PROCESS_NOTIFICATION_RE.test(messageContentText(message.content))

  return background ? 'background' : message.role
}

export const ResponseMessageIds = createContext<readonly string[]>([])

/** Each mounted group owns its cache; text deltas must not reparse settled tool results. */
export function createToolAttentionReader() {
  const cache = new Map<string | ToolPart, { source: ToolPart; needsAttention: boolean }>()

  return (part: ToolPart): boolean => {
    const key = part.toolCallId ?? part
    const cached = cache.get(key)
    const previous = cached?.source

    // assistant-ui copies parts to attach status. Compare the inputs used by
    // toolStatus, as useToolRun does, rather than those wrapper identities.
    if (
      previous &&
      previous.result === part.result &&
      previous.toolResultMetadata === part.toolResultMetadata &&
      previous.toolName === part.toolName &&
      previous.isError === part.isError &&
      previous.completedAt === part.completedAt &&
      previous.interrupted === part.interrupted
    ) {
      return cached.needsAttention
    }

    const status = toolPreviewOutcome(part).status
    const needsAttention = status === 'error' || status === 'warning' || status === 'notice'
    cache.set(key, { source: { ...part }, needsAttention })

    return needsAttention
  }
}

interface ResponseProcessState {
  enabled: boolean
  open: boolean
  answerMessageId?: string
}

export const ResponseProcess = createContext<ResponseProcessState>({ enabled: false, open: true })

/** A stable wrapper keeps tool controls and explicit disclosure choices alive while hidden. */
export function ResponseProcessParts({ children, final = false }: { children: ReactNode; final?: boolean }) {
  const process = useContext(ResponseProcess)
  const messageId = useAuiState(s => s.message.id)
  const answer = final && messageId === process.answerMessageId

  return (
    <div
      className="aui-process-parts"
      data-response-part-kind={answer ? 'answer' : 'process'}
      hidden={process.enabled && !process.open && !answer}
    >
      {children}
    </div>
  )
}

interface ResponseMessagesProps {
  components: ComponentProps<typeof ThreadPrimitive.MessageByIndex>['components']
  indices: readonly number[]
}

interface ResponseRow {
  index: number
  id: string
  role: string
  hasText: boolean
  hasProcess: boolean
  needsAttention: boolean
  hasFinal: boolean
  duration?: number
  running: boolean
  tail: boolean
}

interface ResponseSection {
  key: string
  indices: number[]
  assistantIds: string[]
  response: boolean
  rows: ResponseRow[]
}

function ResponseSectionView({
  components,
  section
}: {
  components: ResponseMessagesProps['components']
  section: ResponseSection
}) {
  const { t } = useI18n()
  const busy = useStore(useSessionView().$busy)
  const running = section.rows.some(row => row.tail && (row.running || busy))
  const answer = running ? undefined : section.rows.findLast(row => row.role === 'assistant' && row.hasFinal)
  const processRows = section.rows.filter(row => row.id !== answer?.id)
  const hasProcess = section.rows.some(row => row.hasProcess) || (answer && processRows.length > 0)
  // Live work stays in the transcript flow; only a completed answer can anchor
  // a process fold. Input/consent, failures and dedicated surfaces stay visible.
  const enabled = Boolean(hasProcess && answer) && !section.rows.some(row => row.needsAttention)
  const disclosureId = `response-process:${section.key}`
  const chosenOpen = useStore($toolDisclosureOpen(disclosureId))
  const open = chosenOpen ?? running
  const duration = answer?.duration ?? section.rows.findLast(row => row.duration !== undefined)?.duration

  const label =
    duration !== undefined
      ? t.assistant.thread.turnDuration(formatElapsed(Math.round(duration)))
      : t.assistant.thread.processTitle

  const process = useMemo(() => ({ enabled, open, answerMessageId: answer?.id }), [enabled, open, answer?.id])
  const responseIdsKey = section.assistantIds.join('\u0000')
  const responseIds = useMemo(() => (responseIdsKey ? responseIdsKey.split('\u0000') : []), [responseIdsKey])
  const indicesKey = section.indices.join(',')

  const messageViews = useMemo(
    () =>
      indicesKey
        .split(',')
        .map(index => <ThreadPrimitive.MessageByIndex components={components} index={Number(index)} key={index} />),
    [components, indicesKey]
  )

  return (
    <ResponseMessageIds.Provider value={responseIds}>
      <ResponseProcess.Provider value={process}>
        <div className="group flex min-w-0 flex-col gap-(--scaffold-block-gap)" data-slot="aui_response-group">
          {enabled && (
            <div className="[--disclosure-caret-rest:0.8]" data-slot="aui_response-process-header">
              <ScaffoldRow onToggle={() => setToolDisclosureOpen(disclosureId, !open)} open={open}>
                <span className={SCAFFOLD_LABEL_CLASS}>{label}</span>
              </ScaffoldRow>
            </div>
          )}
          {section.rows.map((row, index) => (
            <div className="contents" hidden={enabled && !open && !running && row.id !== answer?.id} key={row.index}>
              {messageViews[index]}
            </div>
          ))}
        </div>
      </ResponseProcess.Provider>
    </ResponseMessageIds.Provider>
  )
}

/** Keep message runtimes intact; only their visual container and footer are shared. */
export function ResponseMessages({ components, indices }: ResponseMessagesProps) {
  const toolNeedsAttention = useMemo(createToolAttentionReader, [])

  const signature = useAuiState(s =>
    JSON.stringify(
      indices.flatMap(index => {
        const message = s.thread.messages[index]
        const parts = message?.content ?? []
        const interim = message?.metadata?.custom?.interim === true
        const phases = parts.map(part => (part as { displayPhase?: string }).displayPhase)

        const needsAttention =
          (message?.role === 'assistant' && message.status?.type === 'incomplete') ||
          parts.some(part => {
            if (part.type !== 'tool-call') {
              return part.type === 'image' || part.type === 'data'
            }

            return (
              !!s.tools.toolUIs?.[part.toolName]?.length ||
              (isCardTool(part.toolName) && !isFileEditTool(part.toolName) && part.toolName !== 'delegate_task') ||
              toolNeedsAttention(part as unknown as ToolPart)
            )
          })

        // A history replacement can notify this row before its parent updates indices.
        return message
          ? [
              {
                index,
                id: message.id,
                role: responseMessageRole(message),
                hasText: contentHasVisibleText(message.content),
                hasProcess:
                  interim ||
                  phases.includes('commentary') ||
                  parts.some(part => part.type === 'reasoning' || part.type === 'tool-call'),
                needsAttention,
                hasFinal: !interim && phases.includes('final'),
                duration: message.metadata?.custom?.durationS,
                running: message.role === 'assistant' && message.status?.type === 'running',
                tail: index === s.thread.messages.length - 1
              }
            ]
          : []
      })
    )
  )

  const sections = useMemo(() => {
    const rows = JSON.parse(signature) as ResponseRow[]
    const result: ResponseSection[] = []

    for (const row of rows) {
      const response = row.role === 'assistant' || row.role === 'background'
      const previous = result.at(-1)

      const section: ResponseSection =
        response && previous?.response ? previous : { key: row.id, indices: [], assistantIds: [], response, rows: [] }

      if (section !== previous) {
        result.push(section)
      }

      section.indices.push(row.index)
      section.rows.push(row)

      if (row.role === 'assistant' && row.hasText) {
        section.assistantIds.push(row.id)
      }
    }

    return result
  }, [signature])

  return sections.map(section =>
    section.response ? (
      <ResponseSectionView components={components} key={section.key} section={section} />
    ) : (
      <ThreadPrimitive.MessageByIndex components={components} index={section.indices[0]!} key={section.key} />
    )
  )
}
