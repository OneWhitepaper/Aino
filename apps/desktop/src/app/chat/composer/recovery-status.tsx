import { SessionConnectionStatus } from '@/components/chat/session-connection-status'
import { SessionRecoveryStatus } from '@/components/chat/session-recovery-status'
import type { PlatformSessionAccess } from '@/store/platform-session-access'

import { PlatformHistoryNotice, PlatformSessionPendingNotice } from './platform-history'

interface ComposerRecoveryStatusProps {
  runtimeId?: string | null
  historyOwner?: string | null
  platformAccess?: PlatformSessionAccess
}

export function ComposerRecoveryStatus({ runtimeId, historyOwner, platformAccess }: ComposerRecoveryStatusProps) {
  const foreignOwner = platformAccess?.kind === 'foreign' ? platformAccess.ownerUserId : historyOwner

  return (
    <>
      {foreignOwner != null && <PlatformHistoryNotice ownerUserId={foreignOwner} />}
      {platformAccess && platformAccess.kind !== 'allowed' && platformAccess.kind !== 'foreign' && (
        <PlatformSessionPendingNotice access={platformAccess} sessionId={runtimeId} />
      )}
      <SessionConnectionStatus runtimeId={runtimeId} />
      <SessionRecoveryStatus runtimeId={runtimeId} />
    </>
  )
}
