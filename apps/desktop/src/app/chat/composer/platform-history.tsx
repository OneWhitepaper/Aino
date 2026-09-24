import { useStore } from '@nanostores/react'
import { computed } from 'nanostores'
import { useEffect, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { platformModelCatalog } from '@/store/platform-models'
import { platformHistoryOwner } from '@/store/platform-session-access'
import { requestFreshSession } from '@/store/profile'
import { $sessionStates } from '@/store/session-states'

export function usePlatformHistoryOwner(sessionId?: string | null): string | null {
  const catalog = platformModelCatalog()
  const account = catalog.account
  const authority = catalog.owner
  const snapshot = useStore(account)
  useEffect(() => {
    void authority.load()
  }, [authority, snapshot?.revision, snapshot?.mode, snapshot?.account?.id])

  const owner = useMemo(
    () => computed([account, authority.state, $sessionStates], () => platformHistoryOwner(sessionId)),
    [account, authority, sessionId]
  )

  return useStore(owner)
}

export function PlatformHistoryNotice({ ownerUserId }: { ownerUserId: string }) {
  const { t } = useI18n()

  return (
    // The composer grab ring is an absolute sibling; recovery must sit above it.
    <div
      className="relative z-4 flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
      role="status"
    >
      <span>{t.platformModels.historyReadOnly(ownerUserId)}</span>
      <Button onClick={requestFreshSession} size="sm" variant="textStrong">
        {t.platformModels.newChatCurrentAccount}
      </Button>
    </div>
  )
}
