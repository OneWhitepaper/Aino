import type { ModelOptionsResult } from '@hermes/shared'
import { type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import type { ModelSelection } from '@/app/shell/model-menu-panel'
import { useI18n } from '@/i18n'
import { isBusySessionModelSwitch } from '@/lib/gateway-rpc'
import { surfaceModelSwitchConfirm } from '@/lib/guarded-model-switch'
import { resolveModelDefault } from '@/lib/model-default'
import {
  customDefaultSupersedesPick,
  moaPickRemoved,
  modelOptionsQueryKey,
  requestModelOptions
} from '@/lib/model-options'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { switchSessionModel } from '@/lib/session-model-switch'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { notify, notifyError } from '@/store/notifications'
import { reconcilePlatformDraftAccount } from '@/store/platform-draft-model'
import { platformModelCatalog, PlatformSelectionError } from '@/store/platform-models'
import { platformHistoryOwner } from '@/store/platform-session-access'
import { $activeGatewayProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentModel,
  $currentProvider,
  $currentReasoningEffortWire,
  $modelDefaultUnavailable,
  $selectedStoredSessionId,
  getComposerSelectionGeneration,
  getCurrentModelSource,
  markComposerSelectionDefault,
  markComposerSelectionManual,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider,
  setCurrentReasoningEffortWire
} from '@/store/session'
import { setCurrentPlatformOwner } from '@/store/session'
import { $sessionStates, sessionTileDelegate } from '@/store/session-states'

import { beginModelPick, isPickSuperseded, type ModelPickSnapshot, settleModelPick } from './model-pick-ledger'

interface ModelSwitchResponse {
  confirm_message?: string
  confirm_required?: boolean
  deferred?: boolean
}

interface ModelControlsOptions {
  cacheOwnerConnectionId?: string
  cacheProfile?: string
  queryClient: QueryClient
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
}

function publishResolvedDefault(resolved: Awaited<ReturnType<typeof resolveModelDefault>>): void {
  const { model: resolvedModel, provider: resolvedProvider, platform: resolvedPlatformDefault } = resolved

  if (resolvedModel) {
    setCurrentModel(resolvedModel)
  }

  if (resolvedProvider) {
    setCurrentProvider(resolvedProvider)
  }

  if (resolvedModel || resolvedProvider) {
    $modelDefaultUnavailable.set(false)
    setCurrentModelSource('default')

    if (resolvedPlatformDefault) {
      setCurrentPlatformOwner(resolvedPlatformDefault.ownerUserId, resolvedPlatformDefault.platformOrigin || '')
    } else {
      setCurrentPlatformOwner('')
    }
  }
}

function isCurrentDraftScope(scopeKey: string): boolean {
  return (
    !$activeSessionId.get() &&
    !$selectedStoredSessionId.get() &&
    scopeKey === platformDefaultScope($activeGatewayProfile.get()).key
  )
}

function modelSwitchPath(sessionId: null | string, primary: boolean, nextProvider: string): 'blocked' | 'managed' | 'byok' {
  if (platformHistoryOwner(sessionId) !== null) {
    return 'blocked'
  }

  const provider = primary
    ? ($sessionStates.get()[sessionId!]?.provider ?? $currentProvider.get())
    : ($sessionStates.get()[sessionId!]?.provider ?? '')

  return nextProvider === 'aino' || provider === 'aino' ? 'managed' : 'byok'
}

function modelSwitchScope(primary: boolean, provider: string): string {
  return primary && provider.toLowerCase() !== 'moa' ? '' : ' --session'
}

function modelPickAbandoned(sessionId: string, pickToken: number, primary: boolean): boolean {
  return isPickSuperseded(sessionId, pickToken) || (primary && $activeSessionId.get() !== sessionId)
}

export function useModelControls({
  cacheOwnerConnectionId,
  cacheProfile,
  queryClient,
  requestGateway
}: ModelControlsOptions) {
  const { t } = useI18n()
  const copy = t.desktop
  const profileRefreshEpochRef = useRef(0)
  const handledAccountRef = useRef(platformModelCatalog().account.get())

  const initialCapabilityScope = platformDefaultScope(
    cacheOwnerConnectionId
      ? { connectionId: cacheOwnerConnectionId, profile: cacheProfile || $activeGatewayProfile.get() }
      : cacheProfile || $activeGatewayProfile.get()
  )

  const handledCapabilityRef = useRef({
    key: initialCapabilityScope.key,
    state: managedModelRouteCapabilityFrom($gatewayManagedCapabilities.get(), initialCapabilityScope.route)
  })

  // All callbacks here read reactive session state from the store (.get())
  // rather than capturing it as a prop. The actions bag in wiring.tsx mutates
  // in place to keep a stable identity, so memoized surfaces capture these
  // callbacks once and never re-evaluate — a captured prop would be stale
  // forever. The store read is always current.
  const updateModelOptionsCache = useCallback(
    (
      sessionId: null | string,
      provider: string,
      model: string,
      includeGlobal: boolean,
      profile = cacheProfile || $activeGatewayProfile.get(),
      ownerConnectionId = cacheOwnerConnectionId
    ) => {
      const patch = (prev: ModelOptionsResult | undefined) => {
        // Selection state can update before the catalog query has resolved.
        // Keep that optimistic cache structurally complete; the composer
        // interprets a response without `providers` as an empty catalog.
        const providers = prev?.providers?.length
          ? prev.providers
          : provider && model
            ? [{ models: [model], name: provider, slug: provider }]
            : []

        return { ...prev, provider, model, providers }
      }

      queryClient.setQueryData<ModelOptionsResult>(modelOptionsQueryKey(profile, sessionId, ownerConnectionId), patch)

      if (includeGlobal) {
        queryClient.setQueryData<ModelOptionsResult>(modelOptionsQueryKey(profile, null, ownerConnectionId), patch)
      }
    },
    [cacheOwnerConnectionId, cacheProfile, queryClient]
  )

  // Settings → Model writes the profile default, which the backend applies to
  // new sessions only. Keep a live session's renderer state and session-scoped
  // model-options cache authoritative instead of briefly painting the saved
  // default as if the active agent had switched. Marking the composer as
  // default-derived still lets the next fresh draft reseed from profile config.
  const applySavedMainModel = useCallback(
    (provider: string, model: string) => {
      const liveSessionId = $activeSessionId.get()

      markComposerSelectionDefault()

      if (!liveSessionId) {
        setCurrentProvider(provider)
        setCurrentModel(model)
      }

      // A null session id is the profile-global model-options key. Never patch
      // the live session key here: only config.set --session may change it.
      updateModelOptionsCache(null, provider, model, false)
    },
    [updateModelOptionsCache]
  )

  // Seed the composer's model state from the profile default. `force` reseeds
  // for a profile swap (the new profile has its own default); otherwise this
  // only fills an EMPTY selection so a user's pick (plain UI state in
  // $currentModel) survives the lifecycle refreshes that fire on boot / fresh
  // draft / session events. A live session owns the footer, so skip entirely.
  // Two provably-stale manual picks are the exception and reseed from the
  // profile default: the virtual `moa` provider (#90244) and a bare provider
  // slug the default has migrated to its `custom:<key>` form (#81922).
  const refreshCurrentModel = useCallback(
    async (force = false) => {
      // A forced profile swap opens a new intent epoch; an older in-flight
      // response for a previous profile must stand down when it resolves.
      if (force) {
        profileRefreshEpochRef.current += 1
      }

      const profileRefreshEpoch = profileRefreshEpochRef.current
      const profile = cacheProfile || $activeGatewayProfile.get()
      const scope = cacheOwnerConnectionId ? { connectionId: cacheOwnerConnectionId, profile } : profile
      const scopeKey = platformDefaultScope(scope).key
      let selectionGeneration: number | null = null

      try {
        if (!isCurrentDraftScope(scopeKey)) {
          return
        }

        const account = platformModelCatalog().account.get()

        if (account) {
          reconcilePlatformDraftAccount(account)
        }

        // Capture intent before any catalog I/O so a picker click that lands
        // while the platform list is loading wins over this refresh.
        selectionGeneration = getComposerSelectionGeneration()

        // Catalogs are discovery hints; only the gateway can reject a saved pick.
        const keepManualPick = () => !force && Boolean($currentModel.get()) && getCurrentModelSource() === 'manual'

        let reseedStaleMoa = false

        if (keepManualPick() && $currentProvider.get().toLowerCase() === 'moa') {
          const key = modelOptionsQueryKey(profile, null, cacheOwnerConnectionId)

          const catalog =
            queryClient.getQueryData<ModelOptionsResult>(key) ??
            (await queryClient.fetchQuery({
              queryKey: key,
              queryFn: () => requestModelOptions({ profile, request: requestGateway })
            }))

          reseedStaleMoa = moaPickRemoved(catalog, 'moa', $currentModel.get())
        }

        const maybeCustomAlias =
          keepManualPick() &&
          !!$currentProvider.get() &&
          !$currentProvider.get().includes(':') &&
          $currentProvider.get() !== 'aino'

        if (keepManualPick() && !reseedStaleMoa && !maybeCustomAlias) {
          return
        }

        $modelDefaultUnavailable.set(false)

        // Snapshot the selection generation before awaiting so a picker click
        // that lands while getGlobalModelInfo is in flight wins over this older
        // default — value comparisons alone miss re-selecting the same row.
        const resolved = await resolveModelDefault(scope)

        if (
          profileRefreshEpochRef.current !== profileRefreshEpoch ||
          !isCurrentDraftScope(scopeKey) ||
          getComposerSelectionGeneration() !== selectionGeneration ||
          (keepManualPick() &&
            !reseedStaleMoa &&
            !customDefaultSupersedesPick($currentProvider.get(), resolved.provider))
        ) {
          return
        }

        publishResolvedDefault(resolved)
      } catch (error) {
        if (
          error instanceof PlatformSelectionError &&
          error.code === 'model_unavailable' &&
          profileRefreshEpochRef.current === profileRefreshEpoch &&
          isCurrentDraftScope(scopeKey) &&
          selectionGeneration !== null &&
          getComposerSelectionGeneration() === selectionGeneration
        ) {
          $modelDefaultUnavailable.set(true)
        }
      }
    },
    [cacheOwnerConnectionId, cacheProfile, queryClient, requestGateway]
  )

  const followDefaultModel = useCallback(() => {
    setCurrentModelSource('default')
    void refreshCurrentModel()
  }, [refreshCurrentModel])

  const refreshAccountModel = useCallback(() => {
    const next = platformModelCatalog().account.get()
    const previous = handledAccountRef.current
    // Records the last handled transition, not a mirror used to read current
    // identity. Activity disconnects effects while the login window is open.
    handledAccountRef.current = next

    if (
      next?.phase === 'signed_in' &&
      (next.account?.id !== previous?.account?.id || next.mode !== previous?.mode || previous?.phase !== 'signed_in')
    ) {
      void refreshCurrentModel()
    }
  }, [refreshCurrentModel])

  useEffect(() => {
    refreshAccountModel()

    return platformModelCatalog().account.listen(refreshAccountModel)
  }, [refreshAccountModel])

  useEffect(
    () =>
      $gatewayManagedCapabilities.listen(capabilities => {
        const profile = cacheProfile || $activeGatewayProfile.get()

        const scope = platformDefaultScope(
          cacheOwnerConnectionId ? { connectionId: cacheOwnerConnectionId, profile } : profile
        )

        const state = managedModelRouteCapabilityFrom(capabilities, scope.route)
        const previous = handledCapabilityRef.current
        handledCapabilityRef.current = { key: scope.key, state }

        if (state === 'supported' && (previous.key !== scope.key || previous.state !== 'supported')) {
          void refreshCurrentModel()
        }
      }),
    [cacheOwnerConnectionId, cacheProfile, refreshCurrentModel]
  )

  const selectModel = useCallback(
    async (selection: ModelSelection): Promise<boolean> => {
      const primaryRuntimeId = $activeSessionId.get()
      const liveSessionId = 'sessionId' in selection ? (selection.sessionId ?? null) : primaryRuntimeId
      const touchesPrimary = !liveSessionId || liveSessionId === primaryRuntimeId

      const path = modelSwitchPath(liveSessionId, touchesPrimary, selection.provider)

      if (path === 'blocked') {
        notifyError(new PlatformSelectionError('platform_account_changed'), copy.modelSwitchFailed)

        return false
      }

      // Managed picks and transitions away from Aino stay on the platform
      // authority path, which binds the account before accepting the change.
      if (path === 'managed') {
        return switchSessionModel({
          selection,
          queryClient,
          request: requestGateway,
          cache: updateModelOptionsCache,
          connectionId: cacheOwnerConnectionId,
          profile: cacheProfile || $activeGatewayProfile.get(),
          copy: {
            confirm: t.common.confirm,
            failed: copy.modelSwitchFailed,
            busy: t.platformModels?.switchBusy,
            recovery: t.platformModels?.switchRecovery,
            retry: t.platformModels?.retry
          }
        })
      }

      const readSnapshot = (): ModelPickSnapshot => {
        const tileState = touchesPrimary ? undefined : $sessionStates.get()[liveSessionId!]

        return {
          model: touchesPrimary ? $currentModel.get() : (tileState?.model ?? ''),
          provider: touchesPrimary ? $currentProvider.get() : (tileState?.provider ?? ''),
          reasoningEffortWire: touchesPrimary
            ? $currentReasoningEffortWire.get()
            : (tileState?.reasoningEffortWire ?? ''),
          source: getCurrentModelSource()
        }
      }

      const before = readSnapshot()
      const liveGatewayProfile = cacheProfile || $activeGatewayProfile.get()

      const paintSelection = () => {
        if (touchesPrimary) {
          setCurrentModel(selection.model)
          setCurrentProvider(selection.provider)
          markComposerSelectionManual()
        } else if (liveSessionId) {
          // Optimistic tile paint — session.info will confirm; rollback on error. The wire stamp
          // belongs to the old route, so it is withdrawn until session.info re-stamps it.
          sessionTileDelegate()?.updateSession(liveSessionId, state => ({
            ...state,
            model: selection.model,
            provider: selection.provider,
            reasoningEffortWire: ''
          }))
        }
      }

      const cacheSelection = (provider: string, model: string) => {
        updateModelOptionsCache(liveSessionId, provider, model, touchesPrimary && !liveSessionId, liveGatewayProfile)
      }

      const restoreSnapshot = (snapshot: ModelPickSnapshot) => {
        if (touchesPrimary) {
          setCurrentModel(snapshot.model)
          setCurrentProvider(snapshot.provider)
          // The setters withdraw the wire stamp on a change; the old route's stamp is still true.
          setCurrentReasoningEffortWire(snapshot.reasoningEffortWire)
          setCurrentModelSource(snapshot.source)
        } else if (liveSessionId) {
          sessionTileDelegate()?.updateSession(liveSessionId, state => ({
            ...state,
            model: snapshot.model,
            provider: snapshot.provider,
            reasoningEffortWire: snapshot.reasoningEffortWire
          }))
        }

        cacheSelection(snapshot.provider, snapshot.model)
      }

      paintSelection()
      cacheSelection(selection.provider, selection.model)

      // No live session yet: the pick is pure UI state. session.create reads
      // $currentModel/$currentProvider and applies it as that session's override.
      if (!liveSessionId) {
        return true
      }

      // Overlapping picks on one session settle through the shared ledger: a
      // failed pick repaints the newest pick still in flight, else the last
      // confirmed selection — never its own pre-pick snapshot, which may be an
      // earlier pick's optimistic paint that never applied. A primary session
      // switch while config.set is in flight means nothing is repainted. The
      // composer selection generation is deliberately not consulted: effort
      // steps and preset edits bump it without touching the model.
      const pickToken = beginModelPick(liveSessionId, before, readSnapshot())

      // The snapshot to repaint after this pick failed to apply, or null to leave the paint alone.
      const settleUnapplied = () => {
        const repaint = settleModelPick(liveSessionId, pickToken, false)

        return repaint && !(touchesPrimary && $activeSessionId.get() !== liveSessionId) ? repaint : null
      }

      // The PRIMARY profile's main agent lets the gateway decide persistence
      // (resolve_persist_behavior): session-only by default, persisted when
      // model.persist_switch_by_default is true or when no default has ever
      // been configured (the first-ever pick, so resolve_provider never falls
      // through to a leftover OPENAI_API_KEY env var — #86414). A plain pick
      // no longer silently rewrites config.yaml (#90235); Settings → Model
      // remains the explicit "set as default" door.
      //
      // Two things stay --session, deliberately:
      //  - a SECONDARY chat tile: picking a model there must not rewrite the
      //    profile default (the cross-session-contamination guard).
      //  - MoA (mixture-of-agents) presets: a transient orchestration choice
      //    that must never become the persisted global gateway default.
      const scope = modelSwitchScope(touchesPrimary, selection.provider || '')

      const requestSwitch = (confirmExpensiveModel = false) =>
        requestGateway<ModelSwitchResponse>('config.set', {
          session_id: liveSessionId,
          key: 'model',
          value: `${selection.model} --provider ${selection.provider}${scope}`,
          ...(confirmExpensiveModel ? { confirm_expensive_model: true } : {})
        })

      const finishSwitch = (result: ModelSwitchResponse | undefined) => {
        // A pick made DURING a turn is queued by the gateway and applied at the
        // next turn start (`deferred`). Re-fetching now would answer with the
        // model still running and repaint the old name over the user's choice —
        // the switch publishes session.info when it lands, and that is what
        // re-syncs every surface.
        if (!result?.deferred) {
          void queryClient.invalidateQueries({
            queryKey: modelOptionsQueryKey(liveGatewayProfile, liveSessionId, cacheOwnerConnectionId)
          })
        } else {
          notify({
            id: `model-pick-deferred-${liveSessionId}`,
            kind: 'info',
            message: t.shell.modelMenu.pickDeferred(selection.model)
          })
        }
      }

      try {
        const result = await requestSwitch()

        if (result?.confirm_required) {
          // A newer pick already owns the pill; asking to confirm this one
          // would only offer to undo it.
          const restored = settleUnapplied()

          if (!restored) {
            return false
          }

          restoreSnapshot(restored)
          let retryToken: null | number = null
          // ONE shared applier for guarded switches (#95293): the same
          // confirm flow the Bots editor routes through — never fork this
          // logic per surface.
          // Not awaited: `selectModel` answers "was the switch applied NOW",
          // and that answer only exists once the user answers the dialog.
          void surfaceModelSwitchConfirm({
            confirmMessage: result.confirm_message,
            failureMessage: copy.modelSwitchFailed,
            // Staleness guard — the session or model can move on while the
            // dialog is open. Answering it must not clobber the newer choice:
            // bail (with a notice) if the live state no longer matches the
            // snapshot this prompt was created for.
            isStale: () =>
              touchesPrimary
                ? $activeSessionId.get() !== liveSessionId ||
                  $currentModel.get() !== restored.model ||
                  $currentProvider.get() !== restored.provider
                : !liveSessionId ||
                  $sessionStates.get()[liveSessionId]?.model !== restored.model ||
                  $sessionStates.get()[liveSessionId]?.provider !== restored.provider,
            model: selection.model,
            // The confirmed retry is a fresh pick in the ledger: it joins whatever is still in
            // flight, becomes the confirmed selection when it applies, and settles like any pick
            // when it fails — so an older pick failing later cannot restore what it replaced.
            repaint: () => {
              const retryBefore = readSnapshot()
              paintSelection()
              cacheSelection(selection.provider, selection.model)
              retryToken = beginModelPick(liveSessionId, retryBefore, readSnapshot())
            },
            requestConfirmed: () => requestSwitch(true),
            finish: result => {
              if (retryToken !== null) {
                settleModelPick(liveSessionId, retryToken, true)
              }

              finishSwitch(result)
            },
            rollback: () => {
              const repaint = retryToken === null ? restored : settleModelPick(liveSessionId, retryToken, false)

              if (repaint && !(touchesPrimary && $activeSessionId.get() !== liveSessionId)) {
                restoreSnapshot(repaint)
              }
            }
          })

          return false
        }

        settleModelPick(liveSessionId, pickToken, true)
        finishSwitch(result)

        return true
      } catch (err) {
        // An OLDER gateway refuses a mid-turn switch outright (4009) instead of
        // deferring it. Don't punish the user for a backend they haven't
        // updated: keep the pick painted as the composer's selection, which is
        // what the NEXT turn runs anyway. Current gateways never take this
        // path — they answer `deferred`.
        if (isBusySessionModelSwitch(err)) {
          settleModelPick(liveSessionId, pickToken, true)

          return true
        }

        // An abandoned pick (a newer one was made, or the user left the chat)
        // is not the user's current choice; its failure is not worth a toast.
        const abandoned = modelPickAbandoned(liveSessionId, pickToken, touchesPrimary)

        const restored = settleUnapplied()

        if (restored) {
          restoreSnapshot(restored)
        }

        if (!abandoned) {
          notifyError(err, copy.modelSwitchFailed)
        }

        return false
      }
    },
    [cacheOwnerConnectionId, cacheProfile, copy, queryClient, requestGateway, t, updateModelOptionsCache]
  )

  return { applySavedMainModel, followDefaultModel, refreshCurrentModel, selectModel }
}
