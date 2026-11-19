import type { ExecutionMode } from '@/lib/execution-mode'
import { Codecs, persistentAtom } from '@/lib/persisted'

import { isFreshDraftScope } from '../composer'
import type { ComposerModelSelection } from '../composer-model-selection'

export interface ModeDraft {
  key: string
  cwd: string
  cwdExplicit: boolean
  workspaceTarget?: string | null
  model: ComposerModelSelection
  platformOwner: string
  platformOrigin: string
}

export interface ModeWorkspace {
  sessionId: string | null
  projectScope: string
  draft: ModeDraft | null
}

interface OwnerWorkspace {
  mode: ExecutionMode
  draftMode?: ExecutionMode
  filter: 'current' | 'all'
  work?: ModeWorkspace
  code?: ModeWorkspace
}

// The key names account environment, account id, connection and profile. Values
// carry only navigation/model intent; the composer remains the sole draft owner.
export const $modeWorkspaces = persistentAtom<Record<string, OwnerWorkspace>>(
  'aino.desktop.mode-workspaces.v1',
  {},
  Codecs.json(parseWorkspaces)
)

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseModel(value: unknown): ComposerModelSelection | null {
  if (!record(value) || typeof value.model !== 'string' || typeof value.provider !== 'string') {
    return null
  }

  const source = value.source

  return source === 'manual' || source === 'default' || source === ''
    ? { model: value.model, provider: value.provider, source }
    : null
}

function parseDraft(value: unknown): ModeDraft | null {
  if (
    !record(value) ||
    typeof value.key !== 'string' ||
    !isFreshDraftScope(value.key) ||
    typeof value.cwd !== 'string'
  ) {
    return null
  }

  const model = parseModel(value.model)
  const workspaceTarget = value.workspaceTarget

  if (!model || (workspaceTarget !== undefined && workspaceTarget !== null && typeof workspaceTarget !== 'string')) {
    return null
  }

  return {
    key: value.key,
    cwd: value.cwd,
    cwdExplicit: value.cwdExplicit === true,
    workspaceTarget,
    model,
    platformOwner: typeof value.platformOwner === 'string' ? value.platformOwner : '',
    platformOrigin: typeof value.platformOrigin === 'string' ? value.platformOrigin : ''
  }
}

function parseWorkspace(value: unknown): ModeWorkspace | undefined {
  if (
    !record(value) ||
    typeof value.projectScope !== 'string' ||
    (value.sessionId !== null && typeof value.sessionId !== 'string')
  ) {
    return undefined
  }

  return { sessionId: value.sessionId, projectScope: value.projectScope, draft: parseDraft(value.draft) }
}

function parseWorkspaces(value: unknown): Record<string, OwnerWorkspace> {
  if (!record(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([scope, entry]) => {
      if (!scopeOwner(scope) || !record(entry)) {
        return []
      }

      return [
        [
          scope,
          {
            mode: entry.mode === 'code' ? 'code' : 'work',
            draftMode: entry.draftMode === 'code' || entry.draftMode === 'work' ? entry.draftMode : undefined,
            filter: entry.filter === 'all' ? 'all' : 'current',
            work: parseWorkspace(entry.work),
            code: parseWorkspace(entry.code)
          }
        ]
      ]
    })
  )
}

export function readModePreference(scope: string): ExecutionMode {
  return $modeWorkspaces.get()[scope]?.mode === 'code' ? 'code' : 'work'
}

/** A focused tile may change the visible mode without retagging the primary draft. */
export function readDraftMode(scope: string): ExecutionMode {
  return $modeWorkspaces.get()[scope]?.draftMode ?? readModePreference(scope)
}

export function writeDraftMode(scope: string, mode: ExecutionMode): void {
  const all = $modeWorkspaces.get()
  const previous = all[scope]

  if (previous?.draftMode !== mode) {
    $modeWorkspaces.set({ ...all, [scope]: { ...(previous ?? { mode, filter: 'current' as const }), draftMode: mode } })
  }
}

export function readModeWorkspace(scope: string, mode: ExecutionMode): ModeWorkspace | null {
  const saved = $modeWorkspaces.get()[scope]?.[mode]

  return saved &&
    typeof saved.projectScope === 'string' &&
    (saved.sessionId === null || typeof saved.sessionId === 'string')
    ? saved
    : null
}

export function writeModePreference(scope: string, mode: ExecutionMode): void {
  const all = $modeWorkspaces.get()
  const previous = all[scope]

  if (previous?.mode !== mode) {
    $modeWorkspaces.set({ ...all, [scope]: { ...(previous ?? { filter: 'current' as const }), mode } })
  }
}

export function writeModeWorkspace(scope: string, mode: ExecutionMode, workspace: ModeWorkspace): void {
  const all = $modeWorkspaces.get()
  const previous = all[scope]

  if (JSON.stringify(previous?.[mode]) !== JSON.stringify(workspace)) {
    $modeWorkspaces.set({
      ...all,
      [scope]: { ...(previous ?? { filter: 'current' as const, mode }), [mode]: workspace }
    })
  }
}

export function writeModeFilter(scope: string, filter: 'current' | 'all'): void {
  const all = $modeWorkspaces.get()
  $modeWorkspaces.set({ ...all, [scope]: { ...(all[scope] ?? { mode: 'work' as const }), filter } })
}

function scopeOwner(scope: string): [string, string, string, string] | null {
  try {
    const parsed: unknown = JSON.parse(scope)

    return Array.isArray(parsed) && parsed.length === 4 && parsed.every(item => typeof item === 'string')
      ? (parsed as [string, string, string, string])
      : null
  } catch {
    return null
  }
}

export function migrateModeWorkspacesForProfile(from: string, to: string): void {
  const next = { ...$modeWorkspaces.get() }

  for (const [scope, workspace] of Object.entries(next)) {
    const owner = scopeOwner(scope)

    if (owner?.[2] === 'local' && owner[3] === from) {
      delete next[scope]
      next[JSON.stringify([owner[0], owner[1], owner[2], to])] = workspace
    }
  }

  $modeWorkspaces.set(next)
}

export function dropModeWorkspacesForProfile(profile: string, connectionId: string): void {
  $modeWorkspaces.set(
    Object.fromEntries(
      Object.entries($modeWorkspaces.get()).filter(([scope]) => {
        const owner = scopeOwner(scope)

        return owner?.[2] !== connectionId || owner[3] !== profile
      })
    )
  )
}
