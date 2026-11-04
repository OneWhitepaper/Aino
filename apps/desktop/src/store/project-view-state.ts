import { liveSessionProjectId, type SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { sessionMatchesStoredId } from '@/app/session/hooks/use-session-actions/utils'
import type { ProjectInfo, SessionInfo } from '@/types/hermes'

export function projectInfoToTreeNode(project: ProjectInfo): SidebarProjectTree {
  return {
    id: project.id,
    label: project.name || project.id,
    path: project.primary_path ?? project.folders?.[0]?.path ?? null,
    color: project.color ?? null,
    icon: project.icon ?? null,
    isAuto: false,
    repos: [],
    sessionCount: 0,
    previewSessions: []
  }
}

export function openSessionBelongsToProject(
  projectId: string,
  projects: ProjectInfo[],
  openId: string | null,
  sessions: SessionInfo[],
  owners: Parameters<typeof liveSessionProjectId>[2]
): boolean {
  if (!openId) {
    return false
  }

  const open = sessions.find(s => sessionMatchesStoredId(s, openId))

  return Boolean(open && liveSessionProjectId(open, projects, owners) === projectId)
}
