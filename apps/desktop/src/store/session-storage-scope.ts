import type { HermesConnection } from '@/global'
import { connectionScopeSuffix } from '@/lib/connection-scoped'

const WORKSPACE_CWD_KEY = 'hermes.desktop.workspace-cwd'

export function composerScopeForConnection(connection: HermesConnection | null): string | null {
  if (!connection) {
    return null
  }

  // Electron may infer the sole `local` registry id onto the ordinary primary
  // descriptor. That remains the legacy single-backend path: only an explicit
  // registry-scoped route earns a new namespace.
  if (connection.mode !== 'remote' && !connection.registryScoped) {
    return ''
  }

  if (connection.connectionId) {
    return `.registry.${encodeURIComponent(connection.connectionId)}.${encodeURIComponent(connection.profile || 'default')}`
  }

  return connectionScopeSuffix(connection)
}

export function workspaceCwdKey(connection: HermesConnection | null): string {
  const profile = connection?.profile?.trim() || 'default'

  if (connection?.mode !== 'remote') {
    // One desktop runs several local profiles, and one shared key let the last
    // profile's project leak into every other profile's new chats (#96834).
    // The default profile keeps the bare key — byte-identical for
    // single-profile users, the connection-scoped.ts contract.
    return profile === 'default' ? WORKSPACE_CWD_KEY : `${WORKSPACE_CWD_KEY}.profile.${encodeURIComponent(profile)}`
  }

  const base = encodeURIComponent(connection.baseUrl || 'remote')

  return `${WORKSPACE_CWD_KEY}.remote.${base}.${encodeURIComponent(profile)}`
}
