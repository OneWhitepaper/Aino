import type { ConversationProjectRef, SharedProject } from '@hermes/shared/gateway-events'
import { atom } from 'nanostores'

export interface OpenSharedProject {
  connectionId: string
  project: SharedProject
  source: ConversationProjectRef
}
const storageKey = 'hermes.desktop.window.sharedProjects'

export function sharedOpenKey(entry: OpenSharedProject): string {
  return JSON.stringify([entry.connectionId, entry.project.install_id, entry.project.environment_id, entry.project.id])
}

/** sessionStorage belongs to this renderer window and survives its reload, never another window's writes. */
export function createSharedProjectWindow(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let initial: OpenSharedProject[] = []

  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) || '[]')

    if (Array.isArray(parsed)) {
      initial = parsed.filter((row): row is OpenSharedProject =>
        Boolean(
          row &&
          typeof row.connectionId === 'string' &&
          row.project &&
          typeof row.project.id === 'string' &&
          typeof row.project.install_id === 'string' &&
          typeof row.project.environment_id === 'string' &&
          typeof row.project.canonical_path === 'string' &&
          Array.isArray(row.project.sources) &&
          row.source &&
          typeof row.source.registration_profile === 'string' &&
          row.project.sources.some(
            (source: ConversationProjectRef) =>
              source.install_id === row.source.install_id &&
              source.project_id === row.source.project_id &&
              source.registration_profile === row.source.registration_profile &&
              source.execution_environment_id === row.source.execution_environment_id &&
              source.cwd === row.source.cwd
          )
        )
      )
    }
  } catch {
    /* Invalid saved presentation state is discarded. */
  }

  const opened = atom(initial)

  const save = (rows: OpenSharedProject[]) => {
    storage.setItem(storageKey, JSON.stringify(rows))
    opened.set(rows)
  }

  return {
    opened,
    open(entry: OpenSharedProject) {
      save([...opened.get().filter(row => sharedOpenKey(row) !== sharedOpenKey(entry)), entry])
    },
    close(entry: OpenSharedProject) {
      save(opened.get().filter(row => sharedOpenKey(row) !== sharedOpenKey(entry)))
    }
  }
}

export const sharedProjectWindow = createSharedProjectWindow(window.sessionStorage)
