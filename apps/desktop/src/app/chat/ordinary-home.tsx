import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useI18n } from '@/i18n'
import { $composerDraft, draftTitleFor, mainComposerScope } from '@/store/composer'
import { $activeGatewayConnectionId } from '@/store/gateway'
import { $newChatConnectionId, $newChatProfile, $newChatRoute } from '@/store/profile'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'

import { conversationRoute } from '../routes'

import { $ordinaryHomeReady, ordinaryNewKind } from './ordinary-new'

/** Resolve before mounting an empty composer; an explicit legacy draft always retains its owner. */
export function OrdinaryHome({ legacy }: { legacy: ReactNode }) {
  const { t } = useI18n()
  const ready = useStore($ordinaryHomeReady)
  const connectionId = useStore($activeGatewayConnectionId)
  const route = useStore($newChatRoute)
  const profile = useStore($newChatProfile)
  const draftConnection = useStore($newChatConnectionId)
  const draft = useStore($composerDraft)
  const attachments = useStore(mainComposerScope.$attachments)
  const active = useStore($activeSessionId)
  const selected = useStore($selectedStoredSessionId)

  const explicit = Boolean(
    route || profile || draftConnection || draft || attachments.length || draftTitleFor(null) || active || selected
  )

  const [result, setResult] = useState<{
    connectionId: string
    kind?: 'conversation' | 'legacy_session'
    error?: string
  } | null>(null)

  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!ready || !connectionId || explicit) {
      return
    }
    let disposed = false
    void ordinaryNewKind(connectionId)
      .then(kind => {
        if (!disposed) {
          setResult({ connectionId, kind })
        }
      })
      .catch(error => {
        if (!disposed) {
          setResult({ connectionId, error: String(error) })
        }
      })

    return () => {
      disposed = true
    }
  }, [ready, connectionId, explicit, attempt])

  if (explicit) {
    return legacy
  }

  if (!ready || !connectionId || result?.connectionId !== connectionId) {
    return <Loader />
  }

  if (result.error) {
    return (
      <div role="alert">
        <p>{result.error}</p>
        <Button onClick={() => setAttempt(value => value + 1)}>{t.common.retry}</Button>
      </div>
    )
  }

  return result.kind === 'conversation' ? <Navigate replace to={conversationRoute('new', { connectionId })} /> : legacy
}
