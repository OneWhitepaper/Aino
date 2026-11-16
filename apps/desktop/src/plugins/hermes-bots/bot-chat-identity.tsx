import './bot-chat-identity.css'

import {
  Button,
  Codicon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host,
  useValue
} from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { $editingBot } from './bot-state'
import { ensureBotProfile } from './canonical-chat'
import { $botMeta, $lastRoster, newBotChat } from './data'
import { isBotHidden } from './hidden-bots'
import { useBots } from './i18n'
import { displayName, rosterConnectionLabel } from './labels'
import { openRosterBot } from './roster-actions'
import { botRosterMeta, botWorkspaceOwnerKey, resolveBotConnectionRoute } from './routing'
import type { ProfileRoute, RosterRow } from './types'

interface BotChatIdentityProps {
  ownerKey: string
  avatarFor: (ownerKey: string, size: number) => ReactNode
}

function openBotModelSettings(bot: RosterRow, b: ReturnType<typeof useBots>): void {
  const resolved = resolveBotConnectionRoute(bot)
  const connectionId = bot.connectionId || host.state.connectionId?.get()

  const owner: ProfileRoute | null =
    resolved.route ||
    (resolved.status === 'not_scoped' && connectionId
      ? {
          connectionId,
          mode: bot.remoteSource ? 'remote' : 'local',
          profile: bot.name,
          targetProfile: bot.targetProfile || bot.name
        }
      : null)

  if (owner && host.openModelSettings?.(owner)) {
    return
  }

  host.notify({
    kind: 'error',
    message: b.bot.openModelSettingsSourceMismatch,
    action: { label: b.bot.openGateways, onClick: () => host.navigate('/settings?tab=gateway') }
  })
}

function editBot(bot: RosterRow, b: ReturnType<typeof useBots>): void {
  void ensureBotProfile(bot)
    .then(row => $editingBot.set(row))
    .catch(error => host.notifyError(error, b.bot.loadFailed))
}

interface BotChatActionsProps {
  ownerKey: string
  sessionId: string
}

export function BotChatActions({ ownerKey, sessionId }: BotChatActionsProps) {
  const b = useBots()
  const roster = useValue($lastRoster)
  const bot = roster.find(row => botWorkspaceOwnerKey(row) === ownerKey)

  if (!bot) {
    return null
  }

  return (
    <div className="aino-bot-chat-actions">
      <Button aria-label={b.navigation.settings} onClick={() => editBot(bot, b)} size="icon-sm" variant="ghost">
        <Codicon name="settings-gear" size={16} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={b.navigation.chatOptions} size="icon-sm" variant="ghost">
            <Codicon name="ellipsis" size={18} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="aino-bot-chat-options-menu">
          <DropdownMenuItem onSelect={() => editBot(bot, b)}>
            <Codicon className="mr-1.5" name="settings-gear" />
            {b.navigation.settings}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => newBotChat(bot)}>
            <Codicon className="mr-1.5" name="comment-discussion" />
            {b.navigation.sideChat}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => host.composer.submit(sessionId, '/compact')}>
            <Codicon className="mr-1.5" name="fold" />
            {b.navigation.compact}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => host.searchSession(sessionId)}>
            <Codicon className="mr-1.5" name="search" />
            {b.navigation.searchChat}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => host.navigate('/profiles')}>
            <Codicon className="mr-1.5" name="layout" />
            {b.navigation.manage}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** The roster owns names and portraits; the canonical stored title stays untouched. */
export function BotChatIdentity({ avatarFor, ownerKey }: BotChatIdentityProps) {
  const b = useBots()
  const roster = useValue($lastRoster)
  const allMeta = useValue($botMeta)
  const bot = roster.find(row => botWorkspaceOwnerKey(row) === ownerKey)

  if (!bot) {
    return null
  }

  const name = displayName(bot, botRosterMeta(bot, allMeta))
  const visibleBots = roster.filter(row => !isBotHidden(row, allMeta))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label={name} className="aino-bot-chat-identity" type="button">
          <span aria-hidden="true" className="aino-bot-chat-identity-avatar">
            {avatarFor(ownerKey, 28)}
          </span>
          <span className="aino-bot-chat-identity-name">{name}</span>
          <Codicon className="aino-bot-chat-identity-caret" name="chevron-down" size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="aino-bot-chat-identity-menu" sideOffset={6}>
        <div className="aino-bot-chat-menu-heading">{b.navigation.switchBot}</div>
        {visibleBots.length > 0 ? (
          <>
            <div className="aino-bot-chat-identity-options">
              {visibleBots.map(candidate => {
                const key = botWorkspaceOwnerKey(candidate)
                const label = displayName(candidate, botRosterMeta(candidate, allMeta))

                const duplicateName =
                  visibleBots.filter(row => displayName(row, botRosterMeta(row, allMeta)) === label).length > 1

                const source = duplicateName ? rosterConnectionLabel(candidate) || candidate.connectionId : null

                return (
                  <DropdownMenuItem
                    className="aino-bot-chat-identity-option"
                    key={key}
                    onSelect={() => void openRosterBot(candidate)}
                  >
                    <span aria-hidden="true" className="aino-bot-chat-identity-option-avatar">
                      {avatarFor(key, 24)}
                    </span>
                    <span className="aino-bot-chat-identity-option-copy">
                      <span>{label}</span>
                      {source ? <small>{source}</small> : null}
                    </span>
                    {key === ownerKey ? <Codicon name="check" size={14} /> : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => editBot(bot, b)}>
          <Codicon className="mr-1.5" name="settings-gear" />
          {b.navigation.settings}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => host.navigate('/profiles')}>
          <Codicon className="mr-1.5" name="layout" />
          {b.navigation.manageAll}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openBotModelSettings(bot, b)}>
          <Codicon className="mr-1.5" name="server" />
          {b.editor.configureModel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
