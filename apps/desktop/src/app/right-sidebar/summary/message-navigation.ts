import { isElementInHiddenPane, queryAllVisible } from '@/components/pane-shell/pane-visibility'
import { navigateToSummaryMessage } from '@/lib/summary-message-navigation'
import { requestRevealThreadMessage } from '@/store/thread-scroll'
import { $toolSession, toolSessionIsCurrent } from '@/store/tool-session'

import type { SummarySession } from './use-summary-session'

/** Reveal a summary citation only inside the foreground session surface. */
export async function revealSummaryMessage(session: SummarySession, messageId: number): Promise<boolean> {
  const isCurrent = () =>
    toolSessionIsCurrent(session) &&
    $toolSession.get().target === session.target &&
    $toolSession.get().runtimeId === session.runtimeId

  if (!isCurrent()) {
    return false
  }

  const storedId = session.storedId

  const anchor = queryAllVisible<HTMLElement>('[data-session-anchor]').find(
    node => node.dataset.sessionAnchor === (session.target === 'main' ? 'workspace' : `session-tile:${storedId}`)
  )

  if (!anchor || anchor.getAttribute('data-chat-surface') === null) {
    return false
  }

  if (!(await requestRevealThreadMessage({ rowId: messageId, root: anchor, isCurrent }, session.runtimeId))) {
    return false
  }

  const result = await navigateToSummaryMessage({
    isCurrent: () => isCurrent() && anchor.isConnected && !isElementInHiddenPane(anchor),
    root: anchor,
    target: { messageId, sessionId: storedId ?? '' }
  })

  return result === 'navigated'
}
