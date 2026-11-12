import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { sessionRecoveryCopy } from '@/i18n/session-recovery'
import { useStoreSelector } from '@/lib/use-session-slice'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $notificationEpoch, notifyError } from '@/store/notifications'
import { $deferredSessionSignIns } from '@/store/session-recovery'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

import { StatusRow } from './status-row'

interface SessionRecoveryStatusProps {
  runtimeId: string | null | undefined
}

const NO_ACCOUNT = atom(null)

/** A deferred sign-in stays near its own draft and never replays a failed send. */
export function SessionRecoveryStatus({ runtimeId }: SessionRecoveryStatusProps) {
  const { locale } = useI18n()
  const copy = sessionRecoveryCopy(locale)
  const entry = useStoreSelector($deferredSessionSignIns, entries => (runtimeId ? entries[runtimeId] : undefined))
  useStore($notificationEpoch)
  useStore(entry?.accountStore ?? NO_ACCOUNT)
  const current = useStoresSelector([$sessionStates, $sessionTiles], () => entry?.isCurrent() ?? false)
  const [pending, setPending] = useState(false)

  if (!entry || !current || !entry.isCurrent()) {
    return null
  }

  const recover = async () => {
    if (pending || !entry.isCurrent()) {
      return
    }

    setPending(true)

    try {
      await entry.recover()
    } catch (error) {
      if (entry.isCurrent()) {
        notifyError(error, copy.signIn)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div data-slot="session-auth-recovery" role="status">
      <StatusRow
        leading={<Codicon name="account" />}
        trailing={
          <Button loading={pending} onClick={() => void recover()} size="micro" variant="text">
            {copy.signIn}
          </Button>
        }
        trailingVisible
      >
        <span className="min-w-0 text-xs text-(--ui-text-secondary)">{copy.authDeferred}</span>
      </StatusRow>
    </div>
  )
}
