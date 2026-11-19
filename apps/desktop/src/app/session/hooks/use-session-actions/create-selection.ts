import { getComposerModelSelection } from '@/store/composer-model-selection'
import {
  $currentFastMode,
  $currentModel,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $currentProvider,
  $currentReasoningEffort,
  $currentServiceTier
} from '@/store/session'

export interface SessionCreateSelection {
  effort: string
  fast: boolean
  serviceTier: string
  model: string
  provider: string
  platformOwner: string
  platformOrigin: string
}

/** Snapshot selection without publishing into another composer's atoms. */
export function captureCreateSelection(
  includeComposerSelection: boolean | 'defaults',
  retainModelSelection = false,
  captured?: SessionCreateSelection
): SessionCreateSelection {
  if (captured) {
    return { ...captured }
  }

  const picked = getComposerModelSelection()

  return {
    effort: includeComposerSelection === true ? $currentReasoningEffort.get().trim() : '',
    fast: $currentFastMode.get(),
    serviceTier: $currentServiceTier.get().trim(),
    model: (retainModelSelection ? $currentModel.get() : picked.model).trim(),
    provider: (retainModelSelection ? $currentProvider.get() : picked.provider).trim(),
    platformOwner: $currentPlatformOwner.get(),
    platformOrigin: $currentPlatformOrigin.get()
  }
}
