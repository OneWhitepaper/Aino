import type { ModelOptionsResult } from '@hermes/shared'
import type { QueryClient } from '@tanstack/react-query'

import { bindSelectedPlatformSession, clearPlatformSession } from '@/api/platform-session-binding'
import type { ModelSelection } from '@/app/shell/model-menu-panel'
import { isBusySessionModelSwitch } from '@/lib/gateway-rpc'
import { type GuardedModelSwitchResult, surfaceModelSwitchConfirm } from '@/lib/guarded-model-switch'
import { modelOptionsQueryKey, modelProviderMatches } from '@/lib/model-options'
import { managedModelSwitchBlocked } from '@/lib/model-switch-policy'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { platformModelStatePatch, type PlatformSessionModel } from '@/lib/platform-session-model'
import { managedModelRouteCapability } from '@/store/gateway-managed-capability'
import { dismissNotification, type NotificationInput, notify, notifyError, readableError } from '@/store/notifications'
import { platformModelCatalog, PlatformSelectionError, requirePlatformSelection } from '@/store/platform-models'
import { platformHistoryOwner } from '@/store/platform-session-access'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $awaitingResponse,
  $busy,
  $currentModel,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $currentProvider,
  $currentReasoningEffort,
  getCurrentModelSource,
  markComposerSelectionManual,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentPlatformOwner,
  setCurrentProvider,
  setCurrentReasoningEffort
} from '@/store/session'
import { $sessionStates, sessionTileDelegate } from '@/store/session-states'
import type { SessionRuntimeInfo } from '@/types/hermes'

interface SwitchAttempt {
  pending: boolean
  clearRecovery?: () => void
}
const attempts = new WeakMap<QueryClient, Map<string, SwitchAttempt>>()

/** A recovery belongs to one selection, and expires when its binding is ready. */
function showSwitchRecovery(
  attempt: SwitchAttempt,
  sessionId: string,
  target: PlatformSessionModel | null,
  current: () => boolean,
  notification: NotificationInput
) {
  attempt.clearRecovery?.()

  const release = () => {
    stopState()
    stopAccount()
    attempt.clearRecovery = undefined
  }

  const id = notify({ ...notification, onDismiss: release })

  const clear = () => {
    release()
    dismissNotification(id)
  }

  attempt.clearRecovery = clear

  const check = () => {
    const state = $sessionStates.get()[sessionId]
    const binding = state?.platformModel

    if (
      !current() ||
      !state ||
      (target &&
        state.provider === 'aino' &&
        state.model === target.modelId &&
        binding?.status === 'ready' &&
        binding.modelId === target.modelId &&
        binding.ownerUserId === target.ownerUserId &&
        (!target.platformOrigin || binding.platformOrigin === target.platformOrigin))
    ) {
      clear()
    }
  }

  const stopState = $sessionStates.listen(check)
  const stopAccount = platformModelCatalog().account.listen(check)
  check()
}

interface SwitchOptions {
  selection: ModelSelection
  queryClient: QueryClient
  profile: string
  connectionId?: string
  request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  cache: (sessionId: string | null, provider: string, model: string, includeGlobal: boolean, profile: string) => void
  copy: { confirm: string; failed: string; busy: string; recovery: string; retry: string }
}

function captureModelSwitch({ selection, queryClient, profile, connectionId, cache, copy }: SwitchOptions) {
  const primaryId = $activeSessionId.get()
  const sessionId = 'sessionId' in selection ? (selection.sessionId ?? null) : primaryId
  const primary = !sessionId || sessionId === primaryId
  const previousState = sessionId ? $sessionStates.get()[sessionId] : undefined

  const previous = {
    model: primary ? $currentModel.get() : (previousState?.model ?? ''),
    provider: primary ? $currentProvider.get() : (previousState?.provider ?? ''),
    platformModel: previousState?.platformModel,
    source: getCurrentModelSource(),
    owner: $currentPlatformOwner.get(),
    origin: $currentPlatformOrigin.get()
  }

  const owner = connectionId ? { connectionId, profile } : profile
  const foregroundScope = platformDefaultScope($activeGatewayProfile.get()).key
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const managed = previous.provider === 'aino' || selection.provider === 'aino'

  const accountCurrent = () => {
    const next = catalog.account.get()

    return (
      !managed ||
      (next?.revision === account?.revision &&
        next?.account?.id === account?.account?.id &&
        next?.phase === account?.phase &&
        next?.mode === account?.mode)
    )
  }

  const canPaintPrimary = () =>
    primary &&
    $activeSessionId.get() === sessionId &&
    platformDefaultScope($activeGatewayProfile.get()).key === foregroundScope

  const busy = () => {
    const state = sessionId ? $sessionStates.get()[sessionId] : undefined

    return Boolean(
      state ? state.busy || state.awaitingResponse : canPaintPrimary() && ($busy.get() || $awaitingResponse.get())
    )
  }

  if (platformHistoryOwner(sessionId) !== null) {
    notifyError(new PlatformSelectionError('platform_account_changed'), copy.failed)

    return null
  }

  if (managedModelSwitchBlocked(previous.provider, selection.provider, busy())) {
    notify({ kind: 'warning', message: copy.busy })

    return null
  }

  if (selection.provider === 'aino') {
    try {
      if (managedModelRouteCapability(platformDefaultScope(owner).route) !== 'supported') {
        throw new PlatformSelectionError('unsupported_gateway')
      }

      requirePlatformSelection(account, catalog.state.get().models, selection.model, account?.account?.id || '')
    } catch (error) {
      notifyError(error, copy.failed)

      return null
    }
  }

  let entries = attempts.get(queryClient)

  if (!entries) {
    entries = new Map()
    attempts.set(queryClient, entries)
  }

  const key = JSON.stringify([platformDefaultScope(owner).key, sessionId])

  if (entries.get(key)?.pending) {
    return null
  }

  const attempt: SwitchAttempt = { pending: true }
  entries.get(key)?.clearRecovery?.()
  entries.set(key, attempt)
  const current = () => entries.get(key) === attempt && accountCurrent()

  const tileExists = () =>
    !!sessionId &&
    !!$sessionStates.get()[sessionId] &&
    $sessionStates.get()[sessionId].storedSessionId === previousState?.storedSessionId

  const paint = (model: string, provider: string, platformModel?: PlatformSessionModel | null, rollback = false) => {
    if (!current()) {
      return
    }

    if (canPaintPrimary()) {
      setCurrentModel(model)
      setCurrentProvider(provider)
      setCurrentPlatformOwner(
        platformModel?.ownerUserId || (rollback ? previous.owner : ''),
        platformModel?.platformOrigin || (rollback ? previous.origin : '')
      )

      if (rollback) {
        setCurrentModelSource(previous.source)
      } else {
        markComposerSelectionManual()
      }
    }

    if (tileExists()) {
      sessionTileDelegate()?.updateSession(sessionId!, state => ({ ...state, model, provider, platformModel }))
    }

    cache(sessionId, provider, model, primary && !sessionId, profile)
  }

  return {
    account,
    attempt,
    busy,
    canPaintPrimary,
    current,
    managed,
    owner,
    paint,
    previous,
    primary,
    sessionId,
    tileExists
  }
}

/** One acceptance boundary for both pickers. Only a pre-acceptance failure rolls
 * back; once staged, session.info wins and recovery never submits a prompt. */
export async function switchSessionModel(options: SwitchOptions): Promise<boolean> {
  const { selection, queryClient, profile, connectionId, request, copy } = options
  const captured = captureModelSwitch(options)

  if (!captured) {
    return false
  }

  const {
    account,
    attempt,
    busy,
    canPaintPrimary,
    current,
    managed,
    owner,
    paint,
    previous,
    primary,
    sessionId,
    tileExists
  } = captured

  const targetPlatform: PlatformSessionModel | null =
    selection.provider === 'aino'
      ? {
          modelId: selection.model,
          ownerUserId: account?.account?.id || '',
          platformOrigin: platformModelCatalog().owner.state.get().owner?.platform_origin,
          status: 'awaiting_managed_credentials'
        }
      : null

  const targetSupportsReasoning =
    selection.provider !== 'aino' ||
    Boolean(
      platformModelCatalog()
        .state.get()
        .models.find(model => model.id === selection.model)?.capabilities.reasoning
    )

  const paintTarget = () => paint(selection.model, selection.provider, targetPlatform)
  let accepted = false
  let configRequested = false
  let nativeCompleted = false
  let recoveryHandled = false

  const clearUnsupportedManagedReasoning = async () => {
    if (!targetPlatform || targetSupportsReasoning) {
      return
    }

    const previousEffort = canPaintPrimary()
      ? $currentReasoningEffort.get()
      : $sessionStates.get()[sessionId!]?.reasoningEffort || ''

    if (!previousEffort) {
      return
    }

    await request('config.set', { key: 'reasoning', session_id: sessionId, value: '' })

    if (!current()) {
      return
    }

    if (canPaintPrimary()) {
      setCurrentReasoningEffort('')
    }

    if (tileExists()) {
      sessionTileDelegate()?.updateSession(sessionId!, state => ({ ...state, reasoningEffort: '' }))
    }
  }

  let selectedProvider = queryClient
    .getQueryData<ModelOptionsResult>(modelOptionsQueryKey(profile, sessionId, connectionId))
    ?.providers?.find(row => modelProviderMatches(row, selection.provider))

  const providerMatchesSelection = (provider?: string) =>
    provider === selection.provider ||
    Boolean(provider && selectedProvider && modelProviderMatches(selectedProvider, provider))

  const canFinishSelection = () => current() && (!primary || canPaintPrimary())

  const rollback = () => {
    if (!accepted) {
      paint(previous.model, previous.provider, previous.platformModel, true)
    }
  }

  const reconcile = async () => {
    const { session_info: info, providers } = await request<ModelOptionsResult & { session_info?: SessionRuntimeInfo }>(
      'model.options',
      {
        session_id: sessionId,
        profile,
        include_session_info: true
      }
    )

    if (!current()) {
      return false
    }

    const patch = platformModelStatePatch(info)
    selectedProvider = providers?.find(row => modelProviderMatches(row, selection.provider)) ?? selectedProvider

    if (!info?.provider || !(patch.model || info.model)) {
      throw new Error(copy.recovery)
    }

    // Staging a first managed pick has no backend owner until binding succeeds.
    const platformModel = patch.platformModel
      ? {
          ...patch.platformModel,
          ownerUserId: patch.platformModel.ownerUserId || targetPlatform?.ownerUserId || previous.owner,
          platformOrigin:
            patch.platformModel.platformOrigin ||
            targetPlatform?.platformOrigin ||
            previous.platformModel?.platformOrigin
        }
      : null

    if (
      targetPlatform &&
      patch.platformModel?.status === 'ready' &&
      (patch.platformModel.ownerUserId !== targetPlatform.ownerUserId ||
        (targetPlatform.platformOrigin && patch.platformModel.platformOrigin !== targetPlatform.platformOrigin))
    ) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    paint(patch.model || info.model!, info.provider, platformModel)

    return (
      providerMatchesSelection(info.provider) &&
      (patch.model || info.model) === selection.model &&
      (info.provider !== 'aino' || platformModel?.status === 'ready')
    )
  }

  const selectionStillCurrent = () => {
    if (!current()) {
      return false
    }

    const state = sessionId ? $sessionStates.get()[sessionId] : undefined
    const model = canPaintPrimary() ? $currentModel.get() : state?.model
    const provider = canPaintPrimary() ? $currentProvider.get() : state?.provider

    return model === selection.model && providerMatchesSelection(provider)
  }

  const authorize = async () => {
    if (!current()) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    if (busy()) {
      throw new Error(copy.busy)
    }

    if (targetPlatform) {
      const authoritativeOwner = await bindSelectedPlatformSession(owner, sessionId!, targetPlatform, request)
      targetPlatform.platformOrigin = authoritativeOwner.platform_origin
    } else {
      await clearPlatformSession(owner, sessionId!)
    }

    nativeCompleted = true

    if (!current()) {
      throw new PlatformSelectionError('platform_account_changed')
    }

    if (!(await reconcile())) {
      throw new Error(copy.recovery)
    }

    attempt.clearRecovery?.()
  }

  const recover = async (error: unknown): Promise<boolean> => {
    recoveryHandled = true

    try {
      if ((await reconcile()) && (targetPlatform || nativeCompleted)) {
        attempt.clearRecovery?.()

        return true
      }
    } catch {
      /* Keep the accepted target awaiting explicit recovery when the read is offline. */
    }

    if (!current()) {
      return false
    }

    showSwitchRecovery(attempt, sessionId!, targetPlatform, current, {
      kind: 'warning',
      message: copy.recovery,
      detail: readableError(error, copy.failed).message,
      action: {
        label: copy.retry,
        onClick: async () => {
          if (!attempt.clearRecovery || attempt.pending || !selectionStillCurrent()) {
            return
          }

          attempt.pending = true

          try {
            // A send or a late acknowledgement may already have completed the
            // binding. Read before authorizing, even while that turn is busy.
            if ((await reconcile()) && (targetPlatform || nativeCompleted)) {
              attempt.clearRecovery?.()
            } else {
              await authorize()
            }
          } catch (error) {
            await recover(error)
          } finally {
            attempt.pending = false
          }
        }
      }
    })

    return false
  }

  const scope =
    primary && selection.provider.toLowerCase() !== 'moa' && previous.provider !== 'aino' ? '' : ' --session'

  const requestSwitch = async (confirmed = false) => {
    if (!current() || (managed && busy())) {
      throw new Error(copy.busy)
    }

    attempt.pending = true

    try {
      configRequested = true

      const result = await request<GuardedModelSwitchResult>('config.set', {
        session_id: sessionId,
        key: 'model',
        ...(selection.provider === 'aino'
          ? { value: selection.model, model_source: 'aino' }
          : { value: `${selection.model} --provider ${selection.provider}${scope}` }),
        // A catalog click is the user's session-switch intent. Managed models
        // only use this flag for the redundant history confirmation; custom
        // providers still surface their pricing/data-use selection guards.
        ...(selection.provider === 'aino' || confirmed ? { confirm_expensive_model: true } : {})
      })

      if (!result?.confirm_required && !result?.deferred) {
        accepted = true

        if (managed) {
          paintTarget()

          await clearUnsupportedManagedReasoning()

          try {
            await authorize()
          } catch (error) {
            if (!(await recover(error))) {
              throw error
            }
          }
        }
      }

      return result
    } catch (error) {
      if (managed) {
        rollback()
      }

      // A lost config acknowledgement can still leave a staged backend. A read
      // distinguishes that from a rejected write before offering authorization.
      if (managed && !accepted && configRequested && current()) {
        try {
          const ready = await reconcile()

          if (selectionStillCurrent()) {
            accepted = true

            if (ready && (targetPlatform || nativeCompleted)) {
              attempt.clearRecovery?.()

              return {}
            }

            await recover(error)
          }
        } catch {
          // No authoritative response: retain the pre-acceptance rollback.
        }
      }

      throw error
    } finally {
      attempt.pending = false
    }
  }

  const finish = (result?: GuardedModelSwitchResult) => {
    if (!result?.deferred && current()) {
      void queryClient.invalidateQueries({ queryKey: modelOptionsQueryKey(profile, sessionId, connectionId) })
    }
  }

  paintTarget()

  if (!sessionId) {
    attempt.pending = false

    return true
  }

  try {
    const result = await requestSwitch()

    if (result?.confirm_required) {
      rollback()
      void surfaceModelSwitchConfirm({
        model: selection.model,
        confirmMessage: result.confirm_message,
        failureMessage: copy.failed,
        finish,
        rollback,
        isStale: () =>
          !current() ||
          attempt.pending ||
          (managed && busy()) ||
          (primary
            ? !canPaintPrimary() ||
              $currentModel.get() !== previous.model ||
              $currentProvider.get() !== previous.provider
            : !tileExists() ||
              $sessionStates.get()[sessionId]?.model !== previous.model ||
              $sessionStates.get()[sessionId]?.provider !== previous.provider),
        repaint: paintTarget,
        requestConfirmed: () => requestSwitch(true)
      })

      return false
    }

    finish(result)

    return canFinishSelection()
  } catch (error) {
    if (!managed && isBusySessionModelSwitch(error)) {
      return canFinishSelection()
    }

    rollback()

    if (current() && !recoveryHandled) {
      notifyError(error, copy.failed)
    }

    return false
  } finally {
    attempt.pending = false
  }
}
