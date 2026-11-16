import './chat-empty.css'

import { type ChatEmptyProps, Codicon, host, useValue } from '@hermes/plugin-sdk'

import { $botMeta, $lastRoster } from './data'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta, botWorkspaceOwnerKey } from './routing'
import type { RosterRow } from './types'

/** Match this surface's canonical registry row; foreground focus is unrelated
 *  when an empty conversation is mounted in another retained tab. */
export function botForChat(roster: readonly RosterRow[], { sessionId, storedSessionId, ownerKey }: ChatEmptyProps) {
  return roster.find(bot => {
    if (ownerKey && botWorkspaceOwnerKey(bot) !== ownerKey) {
      return false
    }

    const canonical = bot.canonical_session
    const ids = [canonical?.id, canonical?.resolved_id].filter(Boolean)

    return ids.some(id => id === sessionId || id === storedSessionId)
  })
}

function useChatBot(props: ChatEmptyProps) {
  const roster = useValue($lastRoster)
  const meta = useValue($botMeta)
  const bot = botForChat(roster, props)

  return bot ? { bot, name: displayName(bot, botRosterMeta(bot, meta)) } : null
}

export function BotChatEmpty(props: ChatEmptyProps) {
  const b = useBots()
  const identity = useChatBot(props)

  if (!identity) {
    return null
  }

  return (
    <div className="bot-chat-welcome" data-slot="bot_chat_empty">
      <h2>{b.welcome.heading}</h2>
      <p>{b.welcome.description(identity.name)}</p>
    </div>
  )
}

/** Suggestions append to the exact live draft. They never send a message or
 *  replace text the user has already written. */
export function BotChatStartingActions(props: ChatEmptyProps) {
  const b = useBots()
  const identity = useChatBot(props)

  if (!identity) {
    return null
  }

  const choices = [
    { icon: 'search', label: b.welcome.research, prompt: b.welcome.researchPrompt },
    { icon: 'file-text', label: b.welcome.file, prompt: b.welcome.filePrompt },
    { icon: 'code', label: b.welcome.code, prompt: b.welcome.codePrompt }
  ] as const

  return (
    <div className="bot-chat-start-actions">
      {choices.map(choice => (
        <button
          key={choice.icon}
          onClick={() => void host.composer.insertText(props.storedSessionId || props.sessionId, choice.prompt)}
          type="button"
        >
          <Codicon name={choice.icon} size={14} />
          <span>{choice.label}</span>
        </button>
      ))}
    </div>
  )
}
