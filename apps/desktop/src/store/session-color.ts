import { computed } from 'nanostores'

import { sessionProjectColor } from '@/app/chat/sidebar/projects/workspace-groups'
import { $projectOwnerBySessionId, $projects } from '@/store/projects'
import { $sessions } from '@/store/session'
import type { ProjectInfo, SessionInfo } from '@/types/hermes'

// The inherited project color for every session, keyed by live session id — the ONE
// source of truth both the sidebar rows and the pane tabs read, so the two
// surfaces can never drift. Recomputed only when the session list or projects
// change (all cold atoms; the working/streaming pulse lives in
// $sessionStates, so a busy flip never rebuilds this), and every consumer reads
// it as an O(1) lookup rather than re-deriving membership per render.
function resolveSessionColor(
  session: SessionInfo,
  projects: ProjectInfo[],
  owners: ReadonlyMap<string, string>
): string | undefined {
  return sessionProjectColor(session, projects, owners) ?? undefined
}

export const $sessionColorById = computed(
  [$sessions, $projects, $projectOwnerBySessionId],
  (sessions, projects, owners) => {
    const map: Record<string, string> = {}

    for (const session of sessions) {
      const color = resolveSessionColor(session, projects, owners)

      if (color) {
        map[session.id] = color
      }
    }

    return map
  }
)

// The color for a single session object (the tabs already hold the SessionInfo
// they render, so they resolve through the same map the sidebar reads). A row
// that isn't in `$sessions` — e.g. a project-tree session older than the
// paginated recents page, opened as a tab — misses the map, so fall back to the
// same resolver the map is built from.
export function sessionColorFor(session: null | SessionInfo | undefined): string | undefined {
  if (!session) {
    return undefined
  }

  return (
    $sessionColorById.get()[session.id] ?? resolveSessionColor(session, $projects.get(), $projectOwnerBySessionId.get())
  )
}
