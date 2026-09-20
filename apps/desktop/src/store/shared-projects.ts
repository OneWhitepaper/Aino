import type { ConversationProjectRef, SharedProject, SharedProjectsResult } from '@hermes/shared/gateway-events'

import { requestGatewayForAgent } from './gateway'

export function projectSourceKey(source: ConversationProjectRef): string {
  return JSON.stringify([
    source.install_id,
    source.execution_environment_id,
    source.registration_profile,
    source.project_id,
    source.cwd
  ])
}

/** Every operation captures the connection; mutations also require the exact registration. */
export function sharedProjects(connectionId: string, request = requestGatewayForAgent) {
  const rpc = <T>(method: string, params: Record<string, unknown>) =>
    request<T>(connectionId, 'default', method, params)

  return {
    list: () => rpc<SharedProjectsResult>('projects.shared.list', {}),
    resolve: (id: string) => rpc<{ project: SharedProject }>('projects.shared.resolve', { shared_project_id: id }),
    register: (registration_profile: string, name: string, canonical_path: string) =>
      rpc<{ project: SharedProject }>('projects.shared.register', {
        registration_profile,
        name,
        canonical_path,
        environment_id: 'local'
      }),
    update: (shared_project_id: string, source: ConversationProjectRef, name: string) =>
      rpc<{ project: SharedProject | null }>('projects.shared.update', { shared_project_id, source, name }),
    delete: (shared_project_id: string, source: ConversationProjectRef) =>
      rpc<{ project: SharedProject | null }>('projects.shared.delete', { shared_project_id, source })
  }
}
