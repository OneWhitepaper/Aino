import { useNavigate } from 'react-router'

import { useSessionView } from '@/app/chat/session-view'
import { openToolPanelResource } from '@/app/right-sidebar/tool-panel-actions'
import { findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, activateTreePane, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { useI18n } from '@/i18n'
import { Globe, Terminal, Zap } from '@/lib/icons'
import { useStoresSelector } from '@/lib/use-session-slice'
import { openBrowserTab } from '@/store/preview'
import { $sessions } from '@/store/session'
import { $sessionOwnerHoldRevision, $sessionTiles, knownOwnerForSession } from '@/store/session-states'
import { resolveToolSessionScope } from '@/store/tool-session'

import { botComposerCopy } from './bot-composer-copy'
import { ContextMenuItem } from './context-menu'
import { useComposerScope } from './scope'

export function botCapabilitiesPath(profile: string, connectionId: string): string {
  return `/capabilities?${new URLSearchParams({ tab: 'skills', profile, connection: connectionId })}`
}

/** User actions stay on this mounted conversation, even when another Bot owns
 * the primary session. Reuse the real panel openers after selecting its pane. */
export function BotComposerMenuActions() {
  const { locale } = useI18n()
  const copy = botComposerCopy(locale)
  const view = useSessionView()
  const scope = useComposerScope()
  const navigate = useNavigate()

  const hasOwner = useStoresSelector(
    [view.$runtimeId, view.$storedId, $sessionTiles, $sessions, $sessionOwnerHoldRevision],
    () => Boolean(scope.profile || knownOwnerForSession(view.$runtimeId.get() ?? view.$storedId.get()))
  )

  const activateSessionPane = () => {
    if (!scope.profile && !knownOwnerForSession(view.$runtimeId.get() ?? view.$storedId.get())) {
      return false
    }

    const tree = $layoutTree.get()
    const storedId = view.$storedId.get()
    const paneId = scope.target === 'main' ? 'workspace' : storedId ? `session-tile:${storedId}` : null
    const group = tree && paneId ? findGroupOfPane(tree, paneId) : null

    if (group && paneId) {
      activateTreePane(group.id, paneId)
      noteActiveTreeGroup(group.id)

      return true
    }

    return false
  }

  return (
    <>
      <ContextMenuItem
        disabled={!hasOwner}
        icon={Zap}
        onSelect={() => {
          const id = view.$runtimeId.get() ?? view.$storedId.get()
          const owner = knownOwnerForSession(id)

          if (!owner && !scope.profile) {
            return
          }

          const route = resolveToolSessionScope(
            owner,
            scope.profile ? scope.connectionId || 'local' : undefined,
            scope.profile ?? undefined
          )

          const profile = owner && typeof owner === 'object' ? owner.targetProfile || route.profile : route.profile
          navigate(botCapabilitiesPath(profile, route.connectionId))
        }}
      >
        {copy.skillsTools}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasOwner}
        icon={Globe}
        onSelect={() => {
          if (activateSessionPane()) {
            openBrowserTab()
          }
        }}
      >
        {copy.openBrowser}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasOwner}
        icon={Terminal}
        onSelect={() => {
          if (activateSessionPane()) {
            openToolPanelResource('terminal')
          }
        }}
      >
        {copy.filesTerminal}
      </ContextMenuItem>
    </>
  )
}
