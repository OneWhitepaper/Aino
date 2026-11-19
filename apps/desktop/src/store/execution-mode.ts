import { atom, computed } from 'nanostores'

import { executionMode, type ExecutionMode } from '@/lib/execution-mode'

import { $freshDraftKey } from './composer'
import { getComposerModelSelection } from './composer-model-selection'
import {
  $executionForegroundId,
  $foregroundRuntimeMode,
  executionWorkspaceOwner,
  runtimeExecutionMode,
  sessionExecutionScope,
  storedExecutionOwnerMatches
} from './execution-mode/foreground'
import {
  $modeWorkspaces,
  readDraftMode,
  readModePreference,
  readModeWorkspace,
  writeDraftMode,
  writeModeFilter,
  writeModePreference,
  writeModeWorkspace
} from './execution-mode/workspaces'
import { platformModelCatalog } from './platform-models'
import { $activeGatewayProfile, $newChatConnectionId, $newChatProfile, $newChatRoute } from './profile'
import { $projectScope } from './project-scope'
import {
  $connection,
  $cronSessions,
  $currentCwd,
  $currentCwdExplicit,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $messagingSessions,
  $newChatWorkspaceTarget,
  $selectedStoredSessionId,
  $sessionResumeRequest,
  $sessions,
  $unlistedSessionOwnerRows,
  $workspaceCwdOwner,
  ownerLookupSessionRows,
  sessionMatchesStoredId
} from './session'
import { $focusedSessionIsTile } from './session-focus'
import { $sessionTiles } from './session-states'

const $account = platformModelCatalog().account
const $sessionModes = atom<Record<string, ExecutionMode>>({})

const $draftExecutionScope = computed(
  [$account, $connection, $activeGatewayProfile, $newChatRoute, $newChatProfile, $newChatConnectionId],
  (account, connection, profile, route, newProfile, newConnection) =>
    JSON.stringify([
      account?.mode ?? '',
      account?.account?.id ?? '',
      route?.connectionId ??
        (newProfile ? newConnection : null) ??
        connection?.connectionId ??
        (connection?.mode === 'remote' ? connection.baseUrl : 'local') ??
        '',
      route?.profile || newProfile || profile
    ])
)

export const $executionModeScope = computed(
  [
    $draftExecutionScope,
    $executionForegroundId,
    $connection,
    $activeGatewayProfile,
    $sessionTiles,
    $sessions,
    $cronSessions,
    $messagingSessions,
    $unlistedSessionOwnerRows,
    $sessionResumeRequest
  ],
  (draftScope, storedId) => (storedId ? sessionExecutionScope(storedId, draftScope) : draftScope)
)

function listedSession(scope: string, storedId: string, sessions = ownerLookupSessionRows()) {
  const [, , connection, profile] = JSON.parse(scope) as string[]

  return sessions.find(
    session =>
      sessionMatchesStoredId(session, storedId) &&
      (!session.connection_id || session.connection_id === connection) &&
      (!session.profile || session.profile === profile)
  )
}

/** Display may assume legacy Work; persistence waits for actual session authority. */
function knownStoredMode(scope: string, storedId: string): ExecutionMode | null {
  const reported = $sessionModes.get()[JSON.stringify([scope, storedId])]
  const value = runtimeExecutionMode(storedId) ?? reported ?? listedSession(scope, storedId)?.execution_mode

  return value === 'work' || value === 'code' ? value : null
}

/** History remains backend-owned. Old rows without execution_mode are Work. */
export const $currentExecutionMode = computed(
  [
    $executionModeScope,
    $modeWorkspaces,
    $executionForegroundId,
    $sessions,
    $cronSessions,
    $messagingSessions,
    $unlistedSessionOwnerRows,
    $sessionModes,
    $foregroundRuntimeMode
  ],
  (scope, workspaces, selectedId) => {
    if (!selectedId) {
      return readDraftMode(scope)
    }

    const row = listedSession(scope, selectedId)
    const rememberedMode = workspaces[scope]?.code?.sessionId === selectedId ? 'code' : 'work'

    return knownStoredMode(scope, selectedId) ?? (row ? executionMode(row.execution_mode) : rememberedMode)
  }
)

export const $executionModeFilter = computed([$executionModeScope, $modeWorkspaces], (scope, workspaces) =>
  workspaces[scope]?.filter === 'all' ? ('all' as const) : ('current' as const)
)

export function setExecutionModeFilter(filter: 'current' | 'all'): void {
  writeModeFilter($executionModeScope.get(), filter)
}

export function getDraftExecutionMode(): ExecutionMode {
  return readDraftMode($draftExecutionScope.get())
}

export function setDraftExecutionMode(mode: ExecutionMode): void {
  const scope = $draftExecutionScope.get()
  writeDraftMode(scope, mode)
  writeModePreference(scope, mode)
}

export function getPreferredExecutionMode(scope = $executionModeScope.get()): ExecutionMode {
  return readModePreference(scope)
}

export function getExecutionWorkspace(mode: ExecutionMode, scope = $executionModeScope.get()) {
  const saved = readModeWorkspace(scope, mode)

  if (!saved?.sessionId) {
    return saved
  }

  if (!storedExecutionOwnerMatches(scope, saved.sessionId)) {
    return { ...saved, sessionId: null }
  }

  const authority = knownStoredMode(scope, saved.sessionId)

  // Repair pointers saved before late runtime metadata revealed the real mode.
  // Retain the draft, rather than reopening the same opposite-mode history.
  return authority && authority !== mode ? { ...saved, sessionId: null } : saved
}

export function rememberExecutionWorkspace(): void {
  const scope = $executionModeScope.get()
  const mode = $currentExecutionMode.get()
  const sessionId = $executionForegroundId.get()
  const previous = getExecutionWorkspace(mode, scope)

  if (sessionId && !knownStoredMode(scope, sessionId) && previous?.sessionId !== sessionId) {
    return
  }

  // A resume publishes selection before its cwd/model. That transient paint
  // cannot replace a draft's launch authority or its workspace.
  const draft =
    !sessionId && $workspaceCwdOwner.get() === null
      ? {
          key: $freshDraftKey.get(),
          cwd: $currentCwd.get(),
          cwdExplicit: $currentCwdExplicit.get(),
          workspaceTarget: $newChatWorkspaceTarget.get(),
          model: getComposerModelSelection(),
          platformOwner: $currentPlatformOwner.get(),
          platformOrigin: $currentPlatformOrigin.get()
        }
      : (previous?.draft ?? null)

  writeModeWorkspace(scope, mode, { sessionId, projectScope: $projectScope.get(), draft })
  writeModePreference(scope, mode)

  if (!$focusedSessionIsTile.get()) {
    writeDraftMode(scope, mode)
  }
}

/** Only foreground authority can select a mode; background reports never navigate. */
export function rememberSessionExecutionMode(storedId: string | null | undefined, value: unknown): void {
  if (!storedId || storedId !== $selectedStoredSessionId.get()) {
    return
  }

  const mode = executionMode(value)

  const scope = sessionExecutionScope(storedId, $draftExecutionScope.get())
  const key = JSON.stringify([scope, storedId])

  if ($sessionModes.get()[key] !== mode) {
    $sessionModes.set({ ...$sessionModes.get(), [key]: mode })
  }

  if (storedId === $executionForegroundId.get()) {
    writeModePreference(scope, mode)
    writeDraftMode(scope, mode)
  }
}

export interface ExecutionModeRequest {
  scope: string
  mode: ExecutionMode
  owner?: ReturnType<typeof executionWorkspaceOwner>
}

export const $executionModeRequest = atom<ExecutionModeRequest | null>(null)

/** Restore a mode's workspace. Opening saved history uses its own normal resume path. */
export function requestExecutionMode(mode: ExecutionMode): void {
  if (mode === $currentExecutionMode.get() && !$executionModeRequest.get()) {
    return
  }

  if (!$executionModeRequest.get()) {
    rememberExecutionWorkspace()
  }

  const scope = $executionModeScope.get()
  writeModePreference(scope, mode)
  $executionModeRequest.set({ scope, mode, owner: executionWorkspaceOwner(scope, $executionForegroundId.get()) })
}
