import { atom } from 'nanostores'

import { readJson, writeJson } from '@/lib/storage'

import type { SessionTileWorkspaceScope } from './session-states'

const BOT_CHAT_SCOPE_KEY = 'hermes.desktop.botChatSessions.v1'

/** Stored ids last opened as a bot's chat. A tile carries `workspaceMode`, but
 *  a bot chat normally lands in MAIN — `in-place` mints no tile when there is
 *  none to front — and main has no tile to carry the scope on. Kept here so a
 *  surface can still tell a companion chat from a working session, persisted
 *  so that survives a relaunch the way tile scope does. */
export const $botChatSessionIds = atom<ReadonlySet<string>>(
  new Set((readJson<unknown>(BOT_CHAT_SCOPE_KEY) as unknown[] | null)?.filter(id => typeof id === 'string') ?? [])
)

/** The bot-mode scope each stored id was last opened under, for the main tab
 *  (which has no tile to carry one). Window-local: the caption falls back to
 *  the stored title until the chat is opened again. */
export const $botChatScopes = atom<Readonly<Record<string, SessionTileWorkspaceScope>>>({})

export function rememberBotChatScope(storedSessionId: string, scope: SessionTileWorkspaceScope): void {
  const isBotChat = scope.workspaceMode === 'bots'
  const current = $botChatSessionIds.get()
  const { [storedSessionId]: previous, ...rest } = $botChatScopes.get()

  const changed = isBotChat
    ? previous?.workspaceOwnerKey !== scope.workspaceOwnerKey || previous?.workspaceTabTitle !== scope.workspaceTabTitle
    : Boolean(previous)

  if (changed) {
    $botChatScopes.set(isBotChat ? { ...rest, [storedSessionId]: scope } : rest)
  }

  if (current.has(storedSessionId) === isBotChat) {
    return
  }

  const next = new Set(current)

  if (isBotChat) {
    next.add(storedSessionId)
  } else {
    next.delete(storedSessionId)
  }

  $botChatSessionIds.set(next)
  writeJson(BOT_CHAT_SCOPE_KEY, next.size ? [...next] : null)
}

/** A compressed tip inherits its exact Bot owner; history and an already-owned tip keep theirs. */
export function inheritBotChatScope(previousStoredSessionId: string, nextStoredSessionId: string): void {
  const scopes = $botChatScopes.get()
  const previous = scopes[previousStoredSessionId]

  if (!previous && !$botChatSessionIds.get().has(previousStoredSessionId)) {
    return
  }

  rememberBotChatScope(nextStoredSessionId, scopes[nextStoredSessionId] ?? previous ?? { workspaceMode: 'bots' })
}
