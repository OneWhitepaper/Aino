import { useEffect, useRef } from 'react'

import { $workspaceOwnerLabels } from '@/components/pane-shell/workspace-scope'
import { useI18n } from '@/i18n'
import { PRODUCT_NAME } from '@/lib/brand'
import { useStoresSelector } from '@/lib/use-session-slice'
import { $botChatScopes, $botChatSessionIds } from '@/store/bot-chat-scope'
import { resetBrowseState } from '@/store/composer-input-history'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { $sessionStates, $sessionTiles, storedSessionIdForRuntimeId } from '@/store/session-states'

import { botComposerCopy } from '../bot-composer-copy'

interface UseComposerPlaceholderOptions {
  canonicalBotChat?: boolean
  disabled: boolean
  homeLayout?: boolean
  reconnecting: boolean
  sessionId: null | string | undefined
  storedSessionId?: null | string
}

/** Identity follows this composer's durable session, including background Bot panes. */
export function useComposerPlaceholder({
  canonicalBotChat,
  disabled,
  reconnecting,
  sessionId,
  storedSessionId
}: UseComposerPlaceholderOptions): string {
  const { locale, t } = useI18n()

  const name = useStoresSelector(
    [
      $workspaceOwnerLabels,
      $botChatScopes,
      $botChatSessionIds,
      $sessionStates,
      $sessionTiles,
      $activeSessionId,
      $selectedStoredSessionId
    ],
    () => {
      const storedId = storedSessionId || (sessionId ? storedSessionIdForRuntimeId(sessionId) || sessionId : null)
      const tile = $sessionTiles.get().find(item => item.storedSessionId === storedId)
      const bot = storedId && ($botChatSessionIds.get().has(storedId) || tile?.workspaceMode === 'bots')
      const ownerKey = storedId && ($botChatScopes.get()[storedId]?.workspaceOwnerKey || tile?.workspaceOwnerKey)

      return bot ? (ownerKey && $workspaceOwnerLabels.get()[ownerKey]) || t.common.bots : PRODUCT_NAME
    }
  )

  const prevSessionIdRef = useRef(sessionId)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = sessionId

    // Persisting the draft adopts the same input-history cursor.
    if (prev !== sessionId && !(prev == null && sessionId)) {
      resetBrowseState(prev)
    }
  }, [sessionId])

  // When the transport is disabled it's because the gateway isn't open.
  // Distinguish a cold start ("Starting Hermes...") from a dropped connection
  // we're trying to restore. During reconnect, keep the textbox editable so a
  // flaky network doesn't block drafting; only submit/backend actions stay
  // disabled until the gateway is open again.
  return disabled
    ? reconnecting
      ? t.composer.placeholderReconnecting
      : t.composer.placeholderStarting
    : canonicalBotChat
      ? botComposerCopy(locale).placeholder(name)
      : t.composer.placeholderTo(name)
}
