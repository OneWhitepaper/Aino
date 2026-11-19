import {
  captureCreateSelection,
  type SessionCreateSelection
} from '@/app/session/hooks/use-session-actions/create-selection'
import { handoffCopy } from '@/i18n/handoff'
import { getRuntimeI18nLocale } from '@/i18n/runtime'
import {
  $activeSessionId,
  $currentCwd,
  $currentCwdExplicit,
  $messages,
  $selectedStoredSessionId
} from '@/store/session'
import { $sessionStates, $sessionTiles } from '@/store/session-states'

export type HandoffSurface = 'main' | 'tile'

export interface HandoffSource {
  selection: SessionCreateSelection
  cwd: string
  cwdExplicit: boolean
}

export function handoffSourceChanged(): never {
  throw new Error(handoffCopy(getRuntimeI18nLocale()).changed)
}

/** Session tiles own a runtime slice, never the primary composer's model/workspace. */
export function readHandoffSource(storedId: string, sourceId: string, surface: HandoffSurface): HandoffSource {
  if (surface === 'main') {
    if (storedId !== $selectedStoredSessionId.get() || sourceId !== $activeSessionId.get()) {
      handoffSourceChanged()
    }

    return {
      selection: captureCreateSelection(true, true),
      cwd: $currentCwd.get(),
      cwdExplicit: $currentCwdExplicit.get()
    }
  }

  const tile = $sessionTiles.get().find(item => item.storedSessionId === storedId)
  const state = $sessionStates.get()[sourceId]

  if (tile?.runtimeId !== sourceId || state?.storedSessionId !== storedId) {
    return handoffSourceChanged()
  }

  return {
    cwd: state.cwd,
    // A runtime working folder alone is not permission to reuse it as Code's writable root.
    cwdExplicit: false,
    selection: {
      model: state.model,
      provider: state.provider,
      effort: state.reasoningEffort,
      fast: state.fast,
      serviceTier: state.serviceTier,
      platformOwner: state.platformModel?.ownerUserId ?? '',
      platformOrigin: state.platformModel?.platformOrigin ?? ''
    }
  }
}

export function handoffMessages(sourceId: string, surface: HandoffSurface) {
  return surface === 'main' ? $messages.get() : ($sessionStates.get()[sourceId]?.messages ?? [])
}
