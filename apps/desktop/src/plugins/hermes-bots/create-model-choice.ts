import { type GuardedModelSwitchResult, surfaceModelSwitchConfirm } from '@hermes/plugin-sdk'

interface CreatedModelResult extends GuardedModelSwitchResult {
  applied?: { model?: boolean }
}

interface CreatedModelChoice {
  model: string
  provider: string
  failureMessage: string
  confirmLabel: string
  isCurrent: () => boolean
  onStale: () => void
  request: (selection: Record<string, unknown>) => Promise<CreatedModelResult>
}

/** A failed or stale health probe cannot finish a replacement creation dialog. */
export async function readCreatedModelReadiness<T>(
  read: () => Promise<T>,
  isCurrent: () => boolean,
  finish: (result: T | null) => boolean
): Promise<boolean | null> {
  const result = await read().catch(() => null)

  return isCurrent() ? finish(result) : null
}

function currentChoice(choice: CreatedModelChoice): boolean {
  if (choice.isCurrent()) {
    return true
  }

  choice.onStale()

  return false
}

/** Drafts retain their clone's model until the final Create action commits a choice. */
export async function applyCreatedModelChoice(choice: CreatedModelChoice): Promise<boolean> {
  const model = choice.model.trim()
  const provider = choice.provider.trim()

  if (!model && !provider) {
    return currentChoice(choice)
  }

  if (!model || !provider) {
    throw new Error(choice.failureMessage)
  }

  if (!currentChoice(choice)) {
    return false
  }

  let result: CreatedModelResult

  try {
    result = await choice.request({ model, provider })
  } catch (error) {
    if (!currentChoice(choice)) {
      return false
    }

    throw error
  }

  if (!currentChoice(choice)) {
    return false
  }

  if (!result.confirm_required) {
    if (result.applied?.model !== true) {
      throw new Error(choice.failureMessage)
    }

    return true
  }

  const accepted = await surfaceModelSwitchConfirm({
    model,
    confirmLabel: choice.confirmLabel,
    confirmMessage: result.confirm_message,
    failureMessage: choice.failureMessage,
    isStale: () => !choice.isCurrent(),
    requestConfirmed: async () => {
      const confirmed = await choice.request({ model, provider, confirm_expensive_model: true })

      if (confirmed.applied?.model !== true) {
        throw new Error(choice.failureMessage)
      }

      return confirmed
    }
  })

  return currentChoice(choice) && accepted
}
