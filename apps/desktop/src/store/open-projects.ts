import { computed } from 'nanostores'

import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'
import { $activeGatewayProfile, $profileScope, ALL_PROFILES, normalizeProfileKey } from '@/store/profile'

interface OpenProject {
  id: string
  path: null | string
}

// Discovery and backend registrations are not evidence that this workspace
// opened a project. Keep that intent separate, per connection and profile.
export const $openProjectsByProfile = connectionScopedAtom<Record<string, OpenProject[]>>(
  'hermes.desktop.openProjectsByProfile',
  {},
  Codecs.json(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(value).map(([profile, projects]) => [
        profile,
        Array.isArray(projects)
          ? projects.filter(
              (project): project is OpenProject =>
                project && typeof project.id === 'string' && (project.path === null || typeof project.path === 'string')
            )
          : []
      ])
    )
  }),
  { includeProfile: false }
)

export const $openedProjects = computed([$openProjectsByProfile, $profileScope], (byProfile, scope) =>
  scope === ALL_PROFILES ? Object.values(byProfile).flat() : (byProfile[scope] ?? [])
)

export function rememberOpenProject(project: OpenProject): void {
  const profile = normalizeProfileKey($activeGatewayProfile.get())
  const byProfile = $openProjectsByProfile.get()
  const opened = byProfile[profile] ?? []

  if (opened.some(entry => entry.id === project.id && entry.path === project.path)) {
    return
  }

  $openProjectsByProfile.set({
    ...byProfile,
    [profile]: [...opened.filter(entry => !isOpenedProject(project, [entry])), project]
  })
}

export function reconcileOpenProjectPaths(profile: string, projects: readonly OpenProject[]): void {
  const byProfile = $openProjectsByProfile.get()
  const opened = byProfile[profile]

  if (!opened?.length) {
    return
  }

  const byId = new Map(projects.map(project => [project.id, project]))

  const reconciled = opened.map(entry => {
    const project = byId.get(entry.id)

    return project && project.path !== entry.path ? { ...entry, path: project.path } : entry
  })

  if (reconciled.some((entry, index) => entry !== opened[index])) {
    $openProjectsByProfile.set({ ...byProfile, [profile]: reconciled })
  }
}

export function isOpenedProject(project: OpenProject, opened = $openedProjects.get()): boolean {
  return opened.some(entry => entry.id === project.id || Boolean(entry.path && entry.path === project.path))
}

export function forgetOpenProject(project: OpenProject, ownerProfile?: string): void {
  const scope = ownerProfile ? normalizeProfileKey(ownerProfile) : $profileScope.get()
  const byProfile = $openProjectsByProfile.get()
  $openProjectsByProfile.set(
    Object.fromEntries(
      Object.entries(byProfile).map(([profile, opened]) => [
        profile,
        scope === ALL_PROFILES || profile === scope
          ? opened.filter(entry => !isOpenedProject(project, [entry]))
          : opened
      ])
    )
  )
}
