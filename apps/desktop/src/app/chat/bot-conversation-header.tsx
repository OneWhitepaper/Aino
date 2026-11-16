import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import {
  $workspaceOwnerLabels,
  WORKSPACE_AVATAR_AREA,
  type WorkspaceAvatarContribution
} from '@/components/pane-shell/workspace-scope'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useContributions } from '@/contrib'
import { ContribBoundary, ContribRender } from '@/contrib/react/boundary'
import { useI18n } from '@/i18n'
import { $pinnedSessionIds } from '@/store/layout'
import { $sessions, getSessionOwnerHint, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import { $sessionTiles, sessionTileDelegate } from '@/store/session-states'

import { SessionActionsMenu } from './sidebar/session-actions-menu'

interface BotConversationHeaderProps {
  ownerKey: string
  sessionId: string
  onDelete: () => Promise<void> | void
  onTogglePin?: () => void
}

function OwnerIdentity({
  ownerKey,
  render
}: {
  ownerKey: string
  render: NonNullable<WorkspaceAvatarContribution['headerFor']>
}) {
  const renderIdentity = useMemo(() => () => render(ownerKey), [ownerKey, render])

  return <ContribRender render={renderIdentity} />
}

function OwnerActions({
  ownerKey,
  sessionId,
  render
}: {
  ownerKey: string
  sessionId: string
  render: NonNullable<WorkspaceAvatarContribution['actionsFor']>
}) {
  const renderActions = useMemo(() => () => render(ownerKey, sessionId), [ownerKey, sessionId, render])

  return <ContribRender render={renderActions} />
}

/** Plugin-owned identity, core-owned session actions. Neither changes the
 *  registry title used to resume this companion's persistent conversation. */
export function BotConversationHeader({ ownerKey, sessionId, onDelete, onTogglePin }: BotConversationHeaderProps) {
  const { t } = useI18n()
  const identities = useContributions(WORKSPACE_AVATAR_AREA)
  const labels = useStore($workspaceOwnerLabels)
  const sessions = useStore($sessions)
  const pins = useStore($pinnedSessionIds)
  const tiles = useStore($sessionTiles)
  const row = sessions.find(session => sessionMatchesStoredId(session, sessionId))
  const owner = tiles.find(tile => tile.storedSessionId === sessionId)?.ownerRoute ?? getSessionOwnerHint(sessionId)
  const profile = owner?.targetProfile || owner?.profile || row?.profile
  const title = labels[ownerKey] || t.common.bots
  const identity = identities.find(item => (item.data as WorkspaceAvatarContribution | undefined)?.headerFor)
  const render = (identity?.data as WorkspaceAvatarContribution | undefined)?.headerFor
  const renderActions = (identity?.data as WorkspaceAvatarContribution | undefined)?.actionsFor

  return (
    <div data-slot="bot-conversation-header">
      <div className="min-w-0 flex-1">
        {identity && render ? (
          <ContribBoundary id={identity.id} variant="chip">
            <OwnerIdentity ownerKey={ownerKey} render={render} />
          </ContribBoundary>
        ) : (
          <span className="text-sm font-medium">{title}</span>
        )}
      </div>
      {identity && renderActions ? (
        <ContribBoundary id={identity.id} variant="chip">
          <OwnerActions ownerKey={ownerKey} render={renderActions} sessionId={sessionId} />
        </ContribBoundary>
      ) : (
        <SessionActionsMenu
          align="end"
          onDelete={() => {
            const delegate = sessionTileDelegate()

            return delegate ? delegate.deleteSession(sessionId) : onDelete()
          }}
          onPin={onTogglePin}
          pinned={pins.includes(row ? sessionPinId(row) : sessionId)}
          profile={profile}
          renameable={false}
          sessionId={sessionId}
          title={title}
        >
          <Button aria-label={t.common.actions} size="icon-sm" variant="ghost">
            <Codicon name="ellipsis" size={18} />
          </Button>
        </SessionActionsMenu>
      )}
    </div>
  )
}
