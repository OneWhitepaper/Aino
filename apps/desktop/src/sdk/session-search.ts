import { $workspaceIsPage } from '@/app/routes'
import { queryAllVisible } from '@/components/pane-shell/pane-visibility'
import { openFindBar } from '@/store/find-in-page'

/** A menu in one visible tile must never search a sibling or a hidden chat. */
export function searchSession(storedSessionId: string): boolean {
  if (!storedSessionId || $workspaceIsPage.get()) {
    return false
  }

  const surface = queryAllVisible('[data-chat-surface]').find(
    element => element.dataset.storedSessionId === storedSessionId
  )

  if (!surface) {
    return false
  }

  openFindBar(surface)

  return true
}
