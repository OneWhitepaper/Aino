import { useStore } from '@nanostores/react'
import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { handoffCopy } from '@/i18n/handoff'
import { chatMessageText } from '@/lib/chat-messages'
import { executionMode } from '@/lib/execution-mode'
import { $notificationEpoch, notifyError } from '@/store/notifications'
import type { SessionRuntimeInfo } from '@/types/hermes'

import { type HandoffLink, openHandoffLink } from './actions'
import { captureHandoffContext, type HandoffContext, readHandoffMetadata, recaptureHandoffContext } from './context'
import { HandoffDialog, type HandoffReview } from './dialog'
import { handoffMessages, type HandoffSurface } from './source'

interface HandoffEntryProps {
  storedSessionId: string | null
  runtimeSessionId: string | null
  enabled?: boolean
  surface?: HandoffSurface
}

export function HandoffEntry(props: HandoffEntryProps) {
  const epoch = useStore($notificationEpoch)

  if (props.enabled === false || !props.storedSessionId || !props.runtimeSessionId) {
    return null
  }

  return (
    <HandoffEntryContent
      key={`${epoch}:${props.surface}:${props.storedSessionId}:${props.runtimeSessionId}`}
      runtimeSessionId={props.runtimeSessionId}
      storedSessionId={props.storedSessionId}
      surface={props.surface ?? 'main'}
    />
  )
}

function HandoffEntryContent({
  storedSessionId,
  runtimeSessionId,
  surface
}: {
  storedSessionId: string
  runtimeSessionId: string
  surface: HandoffSurface
}) {
  const { locale } = useI18n()
  const copy = handoffCopy(locale)
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<{ info: SessionRuntimeInfo; context: HandoffContext } | null>(null)
  const info = loaded?.info
  const [review, setReview] = useState<HandoffReview | null>(null)
  const [refreshContext, setRefreshContext] = useState<HandoffContext | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true

    const load = async () => {
      try {
        const context = refreshContext ?? captureHandoffContext(storedSessionId, runtimeSessionId, surface)
        const result = await readHandoffMetadata(context)

        if (current) {
          setLoaded(result)
          setError('')
        }
      } catch (cause) {
        if (current) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
    }

    void load()

    return () => {
      current = false
    }
  }, [storedSessionId, runtimeSessionId, surface, refreshContext])

  const startReview = (returnTarget?: HandoffLink) => {
    try {
      if (!loaded) {
        return
      }

      const context = recaptureHandoffContext(loaded.context)
      const messages = handoffMessages(runtimeSessionId, surface)

      const candidate = messages.findLast(
        message =>
          message.role === (returnTarget ? 'assistant' : 'user') &&
          !message.interim &&
          !message.pending &&
          !message.hidden
      )

      setReview({
        context,
        sourceMode: executionMode(info?.execution_mode),
        summary: candidate ? chatMessageText(candidate) : '',
        files: info?.handoff?.files ?? [],
        returnTarget
      })
    } catch (cause) {
      notifyError(cause, copy.review)
    }
  }

  const open = (link: HandoffLink) => {
    try {
      if (loaded) {
        openHandoffLink(recaptureHandoffContext(loaded.context), link, navigate)
      }
    } catch (cause) {
      notifyError(cause, copy.review)
    }
  }

  const links = info?.linked_sessions ?? []
  const workSource = links.find(link => link.relation === 'source' && link.execution_mode === 'work')

  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-1">
      <Button disabled={!info} onClick={() => startReview()} size="sm" variant="ghost">
        {info?.execution_mode === 'code' ? copy.toWork : copy.toCode}
      </Button>
      {(links.length > 0 || error) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={copy.child} size="icon-sm" variant="ghost">
              <Link2 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {error && (
              <DropdownMenuItem onSelect={() => notifyError(new Error(error), copy.review)}>{error}</DropdownMenuItem>
            )}
            {links.map(link => (
              <DropdownMenuItem key={`${link.relation}:${link.session_id}`} onSelect={() => open(link)}>
                {link.relation === 'source' ? copy.source : copy.child}: {link.title || link.session_id}
              </DropdownMenuItem>
            ))}
            {info?.execution_mode === 'code' && workSource && (
              <DropdownMenuItem onSelect={() => startReview(workSource)}>{copy.returnResult}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {review && <HandoffDialog onClose={() => setReview(null)} onCreated={setRefreshContext} review={review} />}
    </div>
  )
}
