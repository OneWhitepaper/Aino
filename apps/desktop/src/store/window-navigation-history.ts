import { atom } from 'nanostores'

import type { WorkspaceMode, WorkspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'

import type { SessionTileWorkspaceScope } from './session-states'

export interface WindowNavigationWorkspace {
  mode: WorkspaceMode
  ownerKey: string | null
  newSessionTarget: WorkspaceNewSessionTarget | null
}

/** A visit remembers existing surface identities, never another copy of session state. */
export interface WindowNavigationTarget {
  path: string
  routeState?: unknown
  workspace: WindowNavigationWorkspace
  content?:
    | { kind: 'session'; storedSessionId: string; scope: SessionTileWorkspaceScope; tile?: boolean }
    | { kind: 'pane'; paneId: string }
}

interface WindowNavigationState {
  scope: string | null
  entries: readonly WindowNavigationTarget[]
  index: number
  replay: string | null
}

export type NavigationDirection = -1 | 1
type AvailableTarget = (target: WindowNavigationTarget) => boolean

function presentationKey(target: WindowNavigationTarget): string {
  return JSON.stringify([
    target.content ? null : target.path,
    target.workspace.mode,
    target.workspace.ownerKey,
    target.content?.kind,
    target.content?.kind === 'session' ? target.content.storedSessionId : target.content?.paneId
  ])
}

function targetKey(target: WindowNavigationTarget): string {
  const owner = target.content?.kind === 'session' ? target.content.scope : undefined

  return JSON.stringify([
    presentationKey(target),
    owner?.ownerRoute?.connectionId,
    owner?.ownerRoute?.profile,
    owner?.ownerRoute?.targetProfile ?? owner?.ownerRoute?.profile,
    owner?.ownerProfile
  ])
}

function ownerEnrichment(previous: WindowNavigationTarget, target: WindowNavigationTarget): boolean {
  const before = previous.content?.kind === 'session' ? previous.content.scope : undefined
  const after = target.content?.kind === 'session' ? target.content.scope : undefined

  return (
    presentationKey(previous) === presentationKey(target) &&
    !before?.ownerRoute &&
    Boolean(after?.ownerRoute) &&
    (!before?.ownerProfile || before.ownerProfile === after?.ownerRoute?.profile)
  )
}

/** Window-local Back/Forward visits; the existing router and pane owners still do all navigation. */
export function createWindowNavigationHistory() {
  const state = atom<WindowNavigationState>({ scope: null, entries: [], index: -1, replay: null })

  const destination = (direction: NavigationDirection, available: AvailableTarget): number => {
    const current = state.get()

    for (let index = current.index + direction; index >= 0 && index < current.entries.length; index += direction) {
      if (available(current.entries[index])) {
        return index
      }
    }

    return -1
  }

  return {
    state,
    observe(
      scope: string | null,
      target: WindowNavigationTarget | null,
      options?: { replace?: boolean; interruptReplay?: boolean; settled?: boolean }
    ) {
      const current = state.get()

      if (!scope || !target) {
        if (current.scope !== null || current.entries.length) {
          state.set({ scope: null, entries: [], index: -1, replay: null })
        }

        return
      }

      if (scope !== current.scope) {
        state.set({ scope, entries: [target], index: 0, replay: null })

        return
      }

      const key = targetKey(target)
      const previous = current.entries[current.index]
      const enriched = previous && ownerEnrichment(previous, target)

      // Router and session hydration can commit separately. Only the requested
      // destination acknowledges replay; intermediate surfaces are not visits.
      if (
        current.replay &&
        (options?.settled === false || (current.replay !== key && !enriched)) &&
        !options?.interruptReplay
      ) {
        return
      }

      if (enriched) {
        state.set({
          ...current,
          entries: current.entries.map((entry, index) => (index === current.index ? target : entry)),
          replay: null
        })

        return
      }

      if (previous && targetKey(previous) === key) {
        if (current.replay) {
          state.set({ ...current, replay: null })
        }

        return
      }

      const entries = current.entries.slice(0, current.index + 1)

      if (options?.replace && entries.length) {
        entries[entries.length - 1] = target
      } else {
        entries.push(target)
      }

      state.set({ scope, entries, index: entries.length - 1, replay: null })
    },
    canMove(direction: NavigationDirection, available: AvailableTarget = () => true): boolean {
      return !state.get().replay && destination(direction, available) >= 0
    },
    move(direction: NavigationDirection, available: AvailableTarget = () => true): WindowNavigationTarget | null {
      const current = state.get()

      if (current.replay) {
        return null
      }

      const index = destination(direction, available)

      if (index < 0) {
        return null
      }

      const target = current.entries[index]
      state.set({
        ...current,
        index,
        replay: targetKey(target)
      })

      return target
    }
  }
}

export const windowNavigationHistory = createWindowNavigationHistory()
