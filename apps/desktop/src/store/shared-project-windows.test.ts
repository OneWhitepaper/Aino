import { expect, it, vi } from 'vitest'

import { createSharedProjectWindow } from './shared-project-windows'
import { sharedProjects } from './shared-projects'

const source = {
  install_id: 'host',
  execution_environment_id: 'local',
  registration_profile: 'writer',
  project_id: 'source',
  cwd: '/book'
}
const project = {
  id: 'shared',
  install_id: 'host',
  environment_id: 'local',
  canonical_path: '/book',
  name: 'Book',
  sources: [source]
}
function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    }
  }
}

it('preserves exact shared identities in one window across reload without opening another window', () => {
  const saved = storage()
  const first = createSharedProjectWindow(saved)
  const second = createSharedProjectWindow(storage())
  first.open({ connectionId: 'remote', project, source })
  first.open({ connectionId: 'remote', project: { ...project, environment_id: 'ssh-other' }, source })
  expect(first.opened.get()).toHaveLength(2)
  expect(second.opened.get()).toEqual([])
  expect(createSharedProjectWindow(saved).opened.get()).toEqual(first.opened.get())
  first.close({ connectionId: 'remote', project, source })
  expect(first.opened.get()[0].project.environment_id).toBe('ssh-other')
})

it('routes registration and mutation to captured connection and explicit source without opening a folder', async () => {
  const request = vi.fn().mockResolvedValue({ project })
  const window = createSharedProjectWindow(storage())
  const api = sharedProjects('captured', request)
  await api.register('reviewer', 'Book', '/book')
  await api.update(project.id, source, 'Renamed')
  await api.delete(project.id, source)
  expect(request.mock.calls).toEqual([
    [
      'captured',
      'default',
      'projects.shared.register',
      { registration_profile: 'reviewer', name: 'Book', canonical_path: '/book', environment_id: 'local' }
    ],
    ['captured', 'default', 'projects.shared.update', { shared_project_id: project.id, source, name: 'Renamed' }],
    ['captured', 'default', 'projects.shared.delete', { shared_project_id: project.id, source }]
  ])
  expect(window.opened.get()).toEqual([])
})
