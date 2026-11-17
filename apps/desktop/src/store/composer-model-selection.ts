import { persistString, storedString } from '@/lib/storage'

import {
  $currentModel,
  $currentProvider,
  $currentReasoningEffortWire,
  type ComposerModelSource,
  getComposerSelectionScope,
  getCurrentModelSource,
  setCurrentModelSource,
  setCurrentModelTransient,
  setCurrentProviderTransient
} from './session'
import { COMPOSER_MODEL_KEY, COMPOSER_MODEL_SOURCE_KEY, COMPOSER_PROVIDER_KEY } from './session-storage-scope'

export interface ComposerModelSelection {
  model: string
  provider: string
  source: ComposerModelSource
}

function storedComposerString(base: string): string | null {
  const scope = getComposerSelectionScope()

  return scope === null ? null : storedString(`${base}${scope}`)
}

/** The owner's sticky choice, not the runtime/fallback currently painted in the pill. */
export const getComposerModelSelection = (): ComposerModelSelection => ({
  model: storedComposerString(COMPOSER_MODEL_KEY) ?? '',
  provider: storedComposerString(COMPOSER_PROVIDER_KEY) ?? '',
  source: getCurrentModelSource()
})

export const restoreComposerModelSelection = (): void => {
  const selection = getComposerModelSelection()

  if (selection.model !== $currentModel.get() || selection.provider !== $currentProvider.get()) {
    // The wire level described the outgoing chat's route.
    $currentReasoningEffortWire.set('')
  }

  setCurrentModelTransient(selection.model)
  setCurrentProviderTransient(selection.provider)
}

/** A saved pick that turned out not to apply hands new chats back to the Settings default, rather than
 *  guess which earlier pick to restore. In the storage of the owner `scope` that saved it, which the answer
 *  can outlive, and only while that exact route is still its saved pick. */
export const releaseComposerModelSelection = (route: { model: string; provider: string }, scope: null | string) => {
  if (
    scope === null ||
    storedString(`${COMPOSER_MODEL_SOURCE_KEY}${scope}`) !== 'manual' ||
    storedString(`${COMPOSER_MODEL_KEY}${scope}`) !== route.model ||
    (storedString(`${COMPOSER_PROVIDER_KEY}${scope}`) ?? '') !== route.provider
  ) {
    return
  }

  if (scope === getComposerSelectionScope()) {
    setCurrentModelSource('default')
  } else {
    persistString(`${COMPOSER_MODEL_SOURCE_KEY}${scope}`, 'default')
  }
}
