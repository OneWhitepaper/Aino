import { translateNow } from '@/i18n'
import { activeGateway } from '@/store/gateway'
import { $activeGatewayProfile, $profileScope, ALL_PROFILES, normalizeProfileKey } from '@/store/profile'
import { $projects, $projectTree, projectProfile, refreshProjectTree } from '@/store/projects'
import type { ProjectInfo } from '@/types/hermes'

// One dialog owns one profile/project. Capture that owner once so a delayed
// picker or response cannot write into the next workspace's project cache.
export function projectFolderActions(id: string, ownerProfile?: string) {
  const gateway = activeGateway()
  const scope = $profileScope.get()
  const activeProfile = normalizeProfileKey($activeGatewayProfile.get())
  const profile = scope === ALL_PROFILES ? (ownerProfile ? normalizeProfileKey(ownerProfile) : null) : projectProfile()
  const isCurrent = () => Boolean(
    profile && activeGateway() === gateway && $profileScope.get() === scope &&
    normalizeProfileKey($activeGatewayProfile.get()) === activeProfile
  )

  const request = async (method: 'get' | 'add_folder' | 'set_primary' | 'remove_folder', path?: string) => {
    if (!gateway || !isCurrent()) {
      throw new Error(translateNow('sidebar.projects.activeProfileChanged'))
    }

    const { project } = await gateway.request<{ project: ProjectInfo }>(`projects.${method}`, {
      id,
      profile,
      ...(path !== undefined && { path })
    })

    if (!isCurrent()) {
      throw new Error(translateNow('sidebar.projects.activeProfileChanged'))
    }

    if (scope === ALL_PROFILES) {
      if (method !== 'get') {
        void refreshProjectTree()
      }

      return project
    }

    const projects = $projects.get()
    $projects.set(
      projects.some(row => row.id === id)
        ? projects.map(row => (row.id === id ? project : row))
        : [...projects, project]
    )
    $projectTree.set(
      $projectTree.get().map(row => (row.id === id ? { ...row, path: project.primary_path, label: project.name } : row))
    )

    if (method !== 'get') {
      void refreshProjectTree()
    }

    return project
  }

  return { isCurrent, request }
}
