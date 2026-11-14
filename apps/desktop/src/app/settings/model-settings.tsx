import './model-settings-pages.css'

import type { ModelOptionProvider } from '@hermes/shared'
import { DEFAULT_REASONING_EFFORT, REASONING_EFFORT_VALUES } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { getGlobalModelOptions, saveHermesConfig, setModelAssignment } from '@/hermes'
import type { AuxiliaryTaskAssignment, MoaConfigResponse, ModelAssignmentRequest, StaleAuxAssignment } from '@/hermes'
import { useI18n } from '@/i18n'
import { modelSourceCopy } from '@/i18n/model-source'
import { isCodeSkewRestartRequired } from '@/lib/code-skew-error'
import { AlertTriangle, Cpu, Loader2 } from '@/lib/icons'
import { catalogProviderMatches, findCatalogProvider } from '@/lib/model-options'
import { composerServiceTier } from '@/lib/model-status-label'
import { cn } from '@/lib/utils'
import { showLargeModelNotice } from '@/store/agent-notices'
import { $customModels, withCustomModels } from '@/store/custom-models'
import { setMainModelAssignment } from '@/store/model-assignment'
import { openCustomModelConfig } from '@/store/model-visibility'
import { notify, notifyError, readableError } from '@/store/notifications'
import { savePlatformDraftDefault } from '@/store/platform-draft-model'
import { samePlatformAccount } from '@/store/platform-model-owner'
import { platformModelCatalog } from '@/store/platform-models'

import { hermesConfigCacheWriter, invalidateHermesConfig, useHermesConfigRecord } from '../hooks/use-config-record'
import { useOnProfileSwitch } from '../hooks/use-on-profile-switch'
import { PanelEmpty } from '../overlays/panel'

import {
  AUX_FOLLOW_BASE,
  AuxFollowBaseButton,
  auxMainRoute,
  AuxTaskRouteSummary,
  useAuxTaskRows
} from './aux-task-rows'
import { configSubpageForField } from './config-subpages'
import { CONTROL_TEXT } from './constants'
import { DefaultMainModel } from './default-main-model'
import { getNested, setNested } from './helpers'
import { MainModelDefaults, MainModelPicker, type SpeedTier } from './main-model-controls'
import { MoaModelSlots } from './moa-model-slots'
import { MoaPresetSettings } from './moa-preset-settings'
import { isCustomModelProvider, officialModelProviders } from './model-provider-source'
import { ModelSelect } from './model-select'
import { refreshModelSettingsData, useSettingsAuxiliaryData } from './model-settings-refresh'
import { PlatformModelSettings } from './platform-model-settings'
import { ListRowSkeleton, SectionHeading, SectionHeadingSkeleton } from './primitives'
import { dismissStaleAux, readStaleAuxDismissal, staleAuxFingerprint } from './stale-aux-dismissal'
import { useDeepLinkHighlight } from './use-deep-link-highlight'
import { useDefaultMainModel } from './use-default-main-model'
import { useMoaEditing } from './use-moa-editing'
import { useProviderKeyActivation } from './use-provider-key-activation'
import { useSettingsModelCatalog } from './use-settings-model-catalog'

// Skeleton mirror of the Model settings DOM so the page keeps its shape while
// the provider/model catalog loads, instead of collapsing to a centered
// spinner. Same containers/rhythm as the real render below.
export function ModelSettingsSkeleton({ subpage }: Pick<ModelSettingsProps, 'subpage'> = {}) {
  return (
    <div className="grid gap-6" data-slot="model-settings-skeleton">
      {(subpage === undefined || subpage === 'main') && (
        <section>
          <Skeleton className="mb-3 h-3 w-72 max-w-full" />
          <div className="grid gap-1">
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
          <div className="flex justify-end pt-1">
            <Skeleton className="h-8 w-16" />
          </div>
          <div className="mt-6 grid gap-1">
            <Skeleton className="mb-1 h-3 w-16" />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        </section>
      )}

      {(subpage === undefined || subpage === 'auxiliary' || subpage === 'moa') && (
        <section>
          <SectionHeadingSkeleton />
          <div className="grid gap-1">
            {[0, 1, 2, 3].map(row => (
              <ListRowSkeleton key={row} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// A provider row is "ready" to pick a model from when it reports models. The
// backend now surfaces the full `hermes model` universe (every canonical
// provider), so unconfigured providers come back with `authenticated:false`
// and an empty `models` list — those need a setup step before a model exists.
function isProviderReady(p?: ModelOptionProvider): boolean {
  return !!p && (p.authenticated !== false || (p.models?.length ?? 0) > 0)
}

const NO_PROVIDERS: readonly ModelOptionProvider[] = [{ name: '—', slug: '', models: [] }]

// Options for the main provider Select: the full catalog, but a saved provider
// missing from it stays visible (Radix renders a blank trigger when the
// controlled value has no matching item) while remaining out of the real
// inventory used for readiness/setup metadata.
function mainProviderOptionsFor(providers: readonly ModelOptionProvider[], selectedProvider: string) {
  const options = providers.length ? providers : NO_PROVIDERS

  return providers.length && selectedProvider && !findCatalogProvider(providers, selectedProvider)
    ? [{ name: selectedProvider, slug: selectedProvider, models: [] as string[] }, ...providers]
    : options
}

// True when the provider row is a configured endpoint the backend may know
// more models for than the normal (non-refresh) options load probed: that
// load probes only the CURRENT custom provider, so a named custom_providers
// entry the user just switched to arrives empty until an explicit refresh.
function mayDiscoverModels(row: ModelOptionProvider | undefined): boolean {
  if (!row || row.authenticated === false || (row.models?.length ?? 0) > 0) {
    return false
  }

  return !!row.api_url || row.source === 'model-config' || row.is_user_defined === true
}

// Switching to a configured endpoint whose models list is empty triggers one
// refresh-scoped options fetch so the row populates without blocking the
// switch (#59063). The normal (non-refresh) load probes only the CURRENT
// custom provider, so a freshly-selected one arrives empty. On failure the
// selection stays empty and the user can still type a custom model id in
// ModelSelect.
function refreshEmptyProviderModels(
  slug: string,
  providers: readonly ModelOptionProvider[],
  scopeProfile: string | undefined,
  isCurrentEpoch: () => boolean,
  apply: (providers: ModelOptionProvider[]) => void
): void {
  if (!mayDiscoverModels(providers.find(p => catalogProviderMatches(p, slug)))) {
    return
  }

  getGlobalModelOptions({ refresh: true, includeUnconfigured: true }, scopeProfile)
    .then(options => {
      if (isCurrentEpoch()) {
        apply(options.providers || [])
      }
    })
    .catch(() => {})
}

// Persistent mismatch: any aux slot pinned to a provider different from the
// current main, regardless of whether the user just switched. Catches the
// "I pinned aux months ago and forgot, now it bills a dead provider" case.
// A pin on a private/LAN endpoint (per-task base_url, e.g. a home Ollama box)
// never bills a provider, so the backend's `local_endpoint` verdict exempts it.
export function staleAuxAssignments(
  tasks: readonly AuxiliaryTaskAssignment[],
  mainProvider: string
): StaleAuxAssignment[] {
  const main = mainProvider.toLowerCase()

  if (!main) {
    return []
  }

  return (
    tasks
      .filter(entry => {
        const p = (entry.provider ?? '').toLowerCase()

        // 'main' is a backend alias meaning "follow the current main provider"
        // (auxiliary_client._normalize_aux_provider), so it can never be a stale pin.
        return p && p !== 'auto' && p !== 'main' && p !== main && !entry.local_endpoint
      })
      // base_url rides along for the dismissal fingerprint (see
      // stale-aux-dismissal.ts): repointing a pin at a different endpoint changes
      // the billing surface and must re-arm an acknowledged banner.
      .map(entry => ({ base_url: entry.base_url, task: entry.task, provider: entry.provider, model: entry.model }))
  )
}

interface StaleAuxWarningProps {
  applying: boolean
  /** Offered only on the persistent variant — the post-switch notice announces
   *  a change that just happened and must not be silenced. */
  onDismiss?: () => void
  onReset: () => void
  slots: readonly StaleAuxAssignment[]
  taskLabel: (key: string) => string
}

// Shared notice: auxiliary tasks still pinned to a provider that isn't the
// current main. Surfaces the silent credit-burn path (e.g. aux pinned to a
// $0-balance provider after switching main away from it) and offers the
// existing one-click reset rather than auto-clearing legitimate pins.
// The warning uses the same neutral body and semantic icon as other notices.
function StaleAuxWarning({ applying, onDismiss, onReset, slots, taskLabel }: StaleAuxWarningProps) {
  const { t } = useI18n()
  const m = t.settings.model

  if (!slots.length) {
    return null
  }

  const provider = slots[0].provider
  const allSameProvider = slots.every(slot => slot.provider === provider)
  const names = slots.map(slot => taskLabel(slot.task)).join(', ')
  const providerMarker = allSameProvider ? provider : m.staleAuxOtherProviders

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-(--aino-radius-control) border border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) px-3 py-2 text-[length:var(--aino-text-ui)] text-(--ui-text-secondary)">
      <AlertTriangle className="size-4 shrink-0 text-(--ui-yellow)" />
      <span className="min-w-0 grow [overflow-wrap:anywhere]">
        {m.staleAuxBefore(slots.length, names)}
        <span className="font-mono">{providerMarker}</span>
        {m.staleAuxAfter}
      </span>
      <Button disabled={applying} onClick={onReset} size="sm" variant="textStrong">
        {m.resetAllToMain}
      </Button>
      {onDismiss && (
        <Button disabled={applying} onClick={onDismiss} size="sm" variant="textStrong">
          {m.staleAuxDismiss}
        </Button>
      )}
    </div>
  )
}

interface ModelSettingsProps {
  /** Schema-backed controls share the existing model controller and page. */
  mainSettings?: ReactNode
  fallbackSettings?: ReactNode
  /** Visibility only: changing pages must not reset drafts or cancel autosave. */
  subpage?: string
  /** Notified after the main model is applied, so live UI stores can sync. */
  onMainModelChanged?: (provider: string, model: string) => void
  /** Shared settings "Applies to" scope: a concrete profile to edit instead of
   *  the app's active one, or undefined to follow the active profile (default).
   *  Request-shaped on purpose — the API helpers treat `null` as "deliberately
   *  target the primary/default backend", so this prop never carries null. */
  scopeProfile?: string
}

interface ProviderKeyHintProps {
  needsSetup: boolean
  setupIsApiKey: boolean | undefined
  selectedProviderRow: ModelOptionProvider | undefined
}

function ProviderKeyHint({ needsSetup, setupIsApiKey, selectedProviderRow }: ProviderKeyHintProps) {
  const { t } = useI18n()

  return needsSetup && setupIsApiKey && selectedProviderRow ? (
    <p className="mt-2 text-xs text-muted-foreground">
      {t.settings.model.providerNeedsApiKey(selectedProviderRow.name)}
    </p>
  ) : null
}

function appliedModelCapabilities(
  source: ReturnType<typeof useDefaultMainModel>['appliedSource'],
  platformModel: ReturnType<typeof useDefaultMainModel>['appliedPlatformModel'],
  providers: readonly ModelOptionProvider[],
  mainModel: ReturnType<typeof useSettingsModelCatalog>['main']
) {
  if (source === 'aino') {
    return {
      reasoning: platformModel?.capabilities.reasoning ?? false,
      fast: false,
      ultrafast: false
    }
  }

  const row = mainModel ? findCatalogProvider(providers, mainModel.provider) : undefined

  return mainModel ? row?.capabilities?.[mainModel.model] : undefined
}

export function ModelSettings({
  onMainModelChanged,
  scopeProfile,
  subpage,
  mainSettings,
  fallbackSettings
}: ModelSettingsProps) {
  const { locale, t } = useI18n()
  const m = t.settings.model
  const sourceCopy = modelSourceCopy(locale)
  const showMain = subpage === undefined || subpage === 'main'
  const showAuxiliary = subpage === undefined || subpage === 'auxiliary'
  const showMoa = subpage === undefined || subpage === 'moa'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [skewRestart, setSkewRestart] = useState(false)
  const [restartingBackend, setRestartingBackend] = useState(false)
  const modelCatalog = useSettingsModelCatalog(scopeProfile)
  const { auxiliary, mainModel, setAuxiliary } = useSettingsAuxiliaryData(modelCatalog.key, modelCatalog.main)
  const setMainModel = modelCatalog.replaceMain
  const readMainRevision = modelCatalog.readMainRevision
  const mainAssignmentRevision = useRef(0)
  const refreshGeneration = useRef(0)

  const {
    providers: catalogProviders,
    replaceProviders: setCatalogProviders,
    refresh: refreshModelCatalog
  } = modelCatalog

  // Slugs typed into any picker ride along as rows of their provider, so a
  // model added from the composer is selectable here too.
  const customModels = useStore($customModels)
  const providers = useMemo(() => withCustomModels(catalogProviders, customModels), [catalogProviders, customModels])
  const defaultMain = useDefaultMainModel(mainModel, scopeProfile, providers)
  const { selectedProvider, selectedModel, setProviderModel: setSelectedModel } = defaultMain

  const officialProviders = useMemo(
    () =>
      officialModelProviders(providers, modelCatalog.envVars).filter(
        row => row.auth_type === 'api_key' && Boolean(row.key_env)
      ),
    [providers, modelCatalog.envVars]
  )

  const customProviders = useMemo(() => providers.filter(isCustomModelProvider), [providers])
  const sourceProviders = defaultMain.source === 'custom' ? customProviders : officialProviders
  const [moa, setMoa] = useState<MoaConfigResponse | null>(null)
  const [selectedMoaPreset, setSelectedMoaPreset] = useState('')
  const [newMoaPresetName, setNewMoaPresetName] = useState('')
  // agent.* defaults round-trip through the shared config cache (read → write
  // back the whole record), so a save here shows in the MCP/model surfaces.
  const { data: config, writeScope } = useHermesConfigRecord(scopeProfile)
  const setConfig = useMemo(() => hermesConfigCacheWriter(scopeProfile), [scopeProfile])
  const [applying, setApplying] = useState(false)
  const [editingAuxTask, setEditingAuxTask] = useState<null | string>(null)

  const [auxDraft, setAuxDraft] = useState<{ model: string; provider: string; reasoningEffort: string }>({
    model: '',
    provider: '',
    reasoningEffort: '__inherit__'
  })

  // Aux slots reported stale by the backend immediately after a main-model
  // switch (provider differs from the new main). Cleared on next switch/reset.
  const [switchStaleAux, setSwitchStaleAux] = useState<StaleAuxAssignment[]>([])
  // Inline API-key entry for picking an unconfigured `api_key` provider in
  // place — mirrors the onboarding ApiKeyForm but scoped to the model picker.
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [activating, setActivating] = useState(false)

  // Deep link from the vision Capabilities detail (?tab=config:model&aux=vision):
  // scroll the auxiliary task row into view and flash it once the list loads.
  useDeepLinkHighlight({
    elementId: task => `aux-task-${task}`,
    param: 'aux',
    ready: task => showAuxiliary && !loading && auxRows.some(meta => meta.key === task)
  })

  useDeepLinkHighlight({
    elementId: field => `setting-field-${field}`,
    param: 'field',
    ready: field =>
      !loading && Boolean(configSubpageForField('model', field) === 'main' ? mainSettings : fallbackSettings)
  })

  // Every profile-scoped async here captures this and bails before writing back,
  // so a request in flight when the user switches profiles can't paint profile
  // A's models/providers into profile B (or fire onMainModelChanged for A).
  const profileEpoch = useRef(0)

  const setCaughtError = useCallback(
    (err: unknown, fallback: string) => {
      const skew = isCodeSkewRestartRequired(err)
      setSkewRestart(skew)
      setError(skew ? m.restartRequired : readableError(err, fallback).message)
    },
    [m.restartRequired]
  )

  const refresh = useCallback(async () => {
    const epoch = profileEpoch.current
    const generation = ++refreshGeneration.current
    const assignmentRevision = mainAssignmentRevision.current
    const isCurrent = () => profileEpoch.current === epoch && refreshGeneration.current === generation
    setLoading(true)
    setError('')
    setSkewRestart(false)

    await refreshModelSettingsData({
      profile: scopeProfile,
      isCurrent,
      canReplaceMain: () => mainAssignmentRevision.current === assignmentRevision,
      readMainRevision,
      replaceMain: setMainModel,
      refreshCatalog: refreshModelCatalog,
      onReady: () => setLoading(false),
      onAuxiliary: setAuxiliary,
      onMoa: moaModels => {
        setMoa(moaModels)
        setSelectedMoaPreset(prev => (prev && moaModels.presets[prev] ? prev : moaModels.default_preset))
      },
      onFailure: error => setCaughtError(error, m.loadFailed)
    }).catch(error => {
      if (isCurrent()) {
        setCaughtError(error, m.loadFailed)
      }
    })

    if (isCurrent()) {
      setLoading(false)
      // A model switch can change config-backed aux slots on the server.
      void invalidateHermesConfig(scopeProfile)
    }
  }, [m.loadFailed, scopeProfile, setCaughtError, refreshModelCatalog, setMainModel, readMainRevision, setAuxiliary])

  // Retire reads and key submissions when the settings owner changes or unmounts.
  // eslint-disable-next-line no-restricted-syntax -- generation owns asynchronous request lifetime, not a mirrored atom
  useEffect(() => {
    const epoch = ++profileEpoch.current
    setApiKeyDraft('')
    setActivating(false)

    return () => {
      profileEpoch.current = epoch + 1
    }
  }, [modelCatalog.key])

  useEffect(() => {
    void refresh()
  }, [refresh, modelCatalog.key])

  // A profile switch swaps the backend under the mounted panel — reload for the
  // new profile (bumping the epoch first so any in-flight A request is discarded).
  useOnProfileSwitch(() => {
    profileEpoch.current += 1
    // The panel stays mounted across profile switches, so clear the previous
    // profile's draft selection before loading the new profile's source of
    // truth. Ordinary same-profile refreshes still preserve in-progress edits.
    setApiKeyDraft('')
    defaultMain.reset()
    void refresh()
  })

  const providerOptions = providers.length ? providers : NO_PROVIDERS
  const mainProviderOptions = mainProviderOptionsFor(sourceProviders, selectedProvider)

  const switchProvider = (slug: string) => {
    const epoch = profileEpoch.current
    defaultMain.chooseProvider(slug)
    refreshEmptyProviderModels(
      slug,
      sourceProviders,
      scopeProfile,
      () => profileEpoch.current === epoch,
      setCatalogProviders
    )
  }

  // MoA reference/aggregator slots must never be the moa virtual provider —
  // that would create a recursive MoA tree (the backend rejects it on save).
  // Hide it from the slot selectors so it isn't offered as a dead choice.
  const moaSlotProviderOptions = providerOptions.filter(provider => (provider.slug || '').toLowerCase() !== 'moa')

  const selectedProviderRow = useMemo(
    () => findCatalogProvider(sourceProviders, selectedProvider),
    [sourceProviders, selectedProvider]
  )

  const selectedProviderModels = selectedProviderRow?.models ?? []

  // An unconfigured provider was picked: no credentials yet, so there are no
  // models to choose. `api_key` providers can be activated inline (paste key);
  // OAuth / external flows hand off to the onboarding sign-in.
  const needsSetup = !!selectedProvider && !isProviderReady(selectedProviderRow)
  const setupIsApiKey = needsSetup && selectedProviderRow?.auth_type === 'api_key' && !!selectedProviderRow?.key_env

  // Clear any half-typed key when switching provider so it can't leak across.
  useEffect(() => {
    setApiKeyDraft('')
  }, [selectedProvider])

  const auxDraftProviderModels = useMemo(
    () => findCatalogProvider(providers, auxDraft.provider)?.models ?? [],
    [auxDraft.provider, providers]
  )

  const modelsForProvider = useCallback(
    (provider: string) => findCatalogProvider(providers, provider)?.models ?? [],
    [providers]
  )

  const { currentMoaPreset, updateMoaPreset, updateMoaSlot, saveMoa } = useMoaEditing({
    moa,
    selectedMoaPreset,
    scopeProfile,
    profileEpoch,
    loadFailed: m.loadFailed,
    setMoa,
    setApplying,
    setError,
    setCaughtError
  })

  const { auxRows, auxiliaryTaskLabel } = useAuxTaskRows(auxiliary?.tasks, { loading, visible: showAuxiliary })

  const persistentStaleAux = useMemo<StaleAuxAssignment[]>(
    () => staleAuxAssignments(auxiliary?.tasks ?? [], mainModel?.provider ?? ''),
    [auxiliary, mainModel]
  )

  // Acknowledgement of the persistent stale-aux banner (#66740): a dismissal
  // is bound to the exact pin configuration it acknowledged, so any slot edit,
  // main switch, or endpoint repoint produces a different fingerprint and
  // re-arms the warning. Seeded lazily at first render (before the data can
  // paint, so an acknowledged banner never flashes); the panel stays mounted
  // across profile switches, so re-read when the scope changes.
  const [dismissedStaleAux, setDismissedStaleAux] = useState<null | string>(() => readStaleAuxDismissal(scopeProfile))

  useEffect(() => {
    setDismissedStaleAux(readStaleAuxDismissal(scopeProfile))
  }, [scopeProfile])

  const staleAuxDismissed =
    persistentStaleAux.length > 0 &&
    dismissedStaleAux === staleAuxFingerprint(mainModel?.provider ?? '', persistentStaleAux)

  // Capabilities of the APPLIED main model — gates the profile-default
  // reasoning/speed controls the same way the composer picker gates per-model
  // edits (reasoning defaults on, fast defaults off when unreported).
  const mainCaps = useMemo(
    () => appliedModelCapabilities(defaultMain.appliedSource, defaultMain.appliedPlatformModel, providers, mainModel),
    [defaultMain.appliedPlatformModel, defaultMain.appliedSource, providers, mainModel]
  )

  const reasoningSupported = mainCaps?.reasoning ?? true
  const fastSupported = mainCaps?.fast ?? false
  const ultrafastSupported = mainCaps?.ultrafast ?? false

  // Hand-written `reasoning_effort: false`/`off` reaches us as boolean false
  // ("false" once stringified) — show it as Off, not an empty select.
  const rawEffort = String(getNested(config ?? {}, 'agent.reasoning_effort') ?? '')
    .trim()
    .toLowerCase()

  const effortValue = rawEffort === 'false' || rawEffort === 'disabled' ? 'none' : rawEffort || DEFAULT_REASONING_EFFORT

  // One profile-default speed: Standard, Fast (Priority) or Ultrafast. Ultrafast
  // only shows as a choice on models that offer it.
  const tier = composerServiceTier(getNested(config ?? {}, 'agent.service_tier'))
  const fastOn = tier === 'priority'
  const speedValue: SpeedTier = fastOn ? 'fast' : tier === 'ultrafast' ? 'ultrafast' : 'normal'

  // Persist a single agent.* default as a sparse patch (PUT /api/config
  // deep-merges onto disk). Never send the whole cached record: it is a
  // default-expanded snapshot, and echoing it back rewrites every key another
  // surface changed meanwhile — a CLI-pinned auxiliary slot came back as
  // provider "auto" / model "" (#95460). Optimistic, with rollback on failure.
  const writeAgentDefault = useCallback(
    async (key: string, value: boolean | string) => {
      if (!config) {
        return
      }

      const prev = config
      const next = setNested(config, key, value)
      setConfig(next)

      try {
        await saveHermesConfig(setNested({}, key, value), writeScope ?? scopeProfile)
      } catch (err) {
        setConfig(prev)
        notifyError(err, m.defaultsFailed)
      }
    },
    [config, m.defaultsFailed, scopeProfile, setConfig, writeScope]
  )

  const { activateApiKeyProvider, invalidateKeyActivation } = useProviderKeyActivation({
    apiKeyDraft,
    owner: modelCatalog.owner,
    ownerKey: modelCatalog.key,
    profileEpoch,
    saveFailed: sourceCopy.saveFailed,
    selectedModel,
    selectedProvider,
    selectedProviderRow,
    setActivating,
    setApiKeyDraft,
    setCatalogProviders,
    setCaughtError,
    setError,
    setSelectedModel,
    source: defaultMain.source
  })

  const startProviderSetup = () =>
    openCustomModelConfig({
      ...modelCatalog.owner,
      ...(defaultMain.source === 'custom'
        ? {}
        : { kind: 'provider' as const, providerId: selectedProvider || undefined })
    })

  const applyMainModel = useCallback(async () => {
    if (!selectedProvider || !selectedModel) {
      return
    }

    const epoch = profileEpoch.current
    mainAssignmentRevision.current++
    setApplying(true)
    setError('')

    try {
      const result = await setMainModelAssignment(
        {
          model: selectedModel,
          provider: selectedProvider,
          ...(selectedProviderRow?.api_url ? { base_url: selectedProviderRow.api_url } : {})
        },
        scopeProfile
      )

      if (profileEpoch.current !== epoch) {
        return
      }

      const provider = result.provider || selectedProvider
      const model = result.model || selectedModel
      setMainModel({ provider, model })

      if (result.notice) {
        showLargeModelNotice(result.notice)
      }

      setSwitchStaleAux(result.stale_aux ?? [])
      notify({ kind: 'success', title: m.mainAppliedTitle, message: m.mainAppliedMessage(model) })

      // Live UI stores mirror the ACTIVE profile's model; a scoped apply
      // changed a different profile and must not repaint them.
      if (scopeProfile == null) {
        onMainModelChanged?.(provider, model)
      }

      await refresh()
    } catch (err) {
      setCaughtError(err, m.loadFailed)
    } finally {
      setApplying(false)
    }
  }, [
    m,
    onMainModelChanged,
    refresh,
    scopeProfile,
    selectedModel,
    selectedProvider,
    selectedProviderRow,
    setCaughtError,
    setMainModel
  ])

  const applyPlatformMainModel = async () => {
    const account = defaultMain.platform.account

    if (!account || !defaultMain.platformCanApply) {
      return
    }

    const epoch = profileEpoch.current
    mainAssignmentRevision.current++
    setApplying(true)
    setError('')

    try {
      await savePlatformDraftDefault(account, defaultMain.scope, defaultMain.selectedPlatformId, { activate: true })

      if (profileEpoch.current !== epoch) {
        return
      }

      if (!samePlatformAccount(platformModelCatalog().account.get(), account)) {
        await refresh()

        return
      }

      setMainModel({ provider: '', model: '' })
      setSwitchStaleAux([])
      notify({
        kind: 'success',
        title: m.mainAppliedTitle,
        message: m.mainAppliedMessage(defaultMain.selectedPlatformModel?.display_name || defaultMain.selectedPlatformId)
      })
      // The existing action only repaints the matching empty composer; the session callback is BYOK-only.
      await refresh()
    } catch (err) {
      // The route write can finish before an account fence rejects its result.
      if (profileEpoch.current === epoch && !samePlatformAccount(platformModelCatalog().account.get(), account)) {
        await refresh()
      }

      if (profileEpoch.current === epoch) {
        setCaughtError(err, m.loadFailed)
      }
    } finally {
      if (profileEpoch.current === epoch) {
        setApplying(false)
      }
    }
  }

  // Sibling of the applyMainModel endpoint passthrough (#65254): auxiliary
  // assignments targeting a user-defined provider must carry that provider's
  // endpoint too, or the backend pins the slot without a base_url and the
  // aux resolver falls back to the (possibly different, possibly cleared)
  // main endpoint.
  const endpointForProvider = useCallback(
    (provider: string) => {
      const row = findCatalogProvider(providers, provider)

      return row?.api_url ? { base_url: row.api_url } : {}
    },
    [providers]
  )

  const assignAuxiliary = useCallback(
    async (task: string, route: Omit<ModelAssignmentRequest, 'scope' | 'task'>) => {
      setApplying(true)
      setError('')

      try {
        await setModelAssignment({ ...route, scope: 'auxiliary', task }, scopeProfile)
        await refresh()
      } catch (err) {
        setCaughtError(err, m.loadFailed)
      } finally {
        setApplying(false)
      }
    },
    [m.loadFailed, refresh, scopeProfile, setCaughtError]
  )

  const applyAuxiliaryDraft = useCallback(
    async (task: string) => {
      if (!auxDraft.provider || !auxDraft.model) {
        return
      }

      setApplying(true)
      setError('')

      try {
        await setModelAssignment(
          {
            model: auxDraft.model,
            provider: auxDraft.provider,
            reasoning_effort: auxDraft.reasoningEffort === '__inherit__' ? null : auxDraft.reasoningEffort,
            scope: 'auxiliary',
            task,
            ...endpointForProvider(auxDraft.provider)
          },
          scopeProfile
        )
        setEditingAuxTask(null)
        await refresh()
      } catch (err) {
        setCaughtError(err, m.loadFailed)
      } finally {
        setApplying(false)
      }
    },
    [auxDraft, endpointForProvider, m.loadFailed, refresh, scopeProfile, setCaughtError]
  )

  const beginAuxiliaryEdit = useCallback(
    (task: string) => {
      const current = auxiliary?.tasks.find(entry => entry.task === task)

      const initialProvider =
        current?.provider && current.provider !== 'auto' ? current.provider : (mainModel?.provider ?? '')

      const initialModel = current?.model || mainModel?.model || ''
      const initialReasoningEffort = current?.reasoning_effort ?? '__inherit__'
      setAuxDraft({ provider: initialProvider, model: initialModel, reasoningEffort: initialReasoningEffort })
      setEditingAuxTask(task)
    },
    [auxiliary, mainModel]
  )

  const resetAuxiliaryModels = useCallback(async () => {
    if (!mainModel) {
      return
    }

    setApplying(true)
    setError('')

    try {
      await setModelAssignment(
        {
          model: mainModel.model,
          provider: mainModel.provider,
          scope: 'auxiliary',
          task: '__reset__'
        },
        scopeProfile
      )
      setSwitchStaleAux([])
      await refresh()
    } catch (err) {
      setCaughtError(err, m.loadFailed)
    } finally {
      setApplying(false)
    }
  }, [m.loadFailed, mainModel, refresh, scopeProfile, setCaughtError])

  const recycleStaleBackend = useCallback(async () => {
    setRestartingBackend(true)
    setError('')
    setSkewRestart(false)

    try {
      await window.hermesDesktop?.recycleBackend?.(scopeProfile)
      defaultMain.reset()
      await refresh()
    } catch (err) {
      setCaughtError(err, m.restartFailed)
    } finally {
      setRestartingBackend(false)
    }
  }, [defaultMain, m.restartFailed, refresh, scopeProfile, setCaughtError])

  // Fallbacks are schema-backed controls in ConfigSettings. Keep this
  // controller alive there without rendering controls from another child page.
  if (!showMain && !showAuxiliary && !showMoa) {
    return null
  }

  if (loading && !mainModel) {
    return <ModelSettingsSkeleton subpage={subpage} />
  }

  const errorNotice = error && (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
      <span>{error}</span>
      {skewRestart && (
        <Button disabled={restartingBackend} onClick={() => void recycleStaleBackend()} size="sm" variant="textStrong">
          {restartingBackend && <Loader2 className="size-3.5 animate-spin" />}
          {restartingBackend ? m.restartingBackend : m.restartBackend}
        </Button>
      )}
    </div>
  )

  const mainSourceControls = (
    <div inert={applying || activating}>
      <MainModelPicker
        activateApiKeyProvider={activateApiKeyProvider}
        activating={activating}
        apiKeyDraft={apiKeyDraft}
        m={m}
        mainProviderOptions={mainProviderOptions}
        needsSetup={needsSetup}
        selectedModel={selectedModel}
        selectedProvider={selectedProvider}
        selectedProviderModels={selectedProviderModels}
        selectedProviderRow={selectedProviderRow}
        setApiKeyDraft={setApiKeyDraft}
        setSelectedModel={setSelectedModel}
        setupIsApiKey={!!setupIsApiKey}
        source={defaultMain.source === 'custom' ? 'custom' : 'provider'}
        startProviderSetup={startProviderSetup}
        switchProvider={switchProvider}
      />
      <ProviderKeyHint
        needsSetup={needsSetup}
        selectedProviderRow={selectedProviderRow}
        setupIsApiKey={setupIsApiKey}
      />
    </div>
  )

  return (
    <div className="grid gap-6">
      {!showMain && errorNotice}
      {showMain && (
        <DefaultMainModel
          {...appliedModelLabels(defaultMain, mainModel, providers, sourceCopy, m.defaultMain.builtIn)}
          applying={applying}
          builtinControls={
            <PlatformModelSettings
              disabled={applying}
              onSelect={model => defaultMain.setPlatformModel(model.id)}
              scopeProfile={scopeProfile}
              selectedId={defaultMain.selectedPlatformId}
            />
          }
          canApply={
            !activating &&
            (defaultMain.source === 'aino'
              ? defaultMain.platformCanApply
              : Boolean(selectedProvider && selectedModel && !needsSetup))
          }
          customControls={defaultMain.source === 'custom' ? mainSourceControls : null}
          defaults={
            config && mainModel ? (
              <>
                <MainModelDefaults
                  effortValue={effortValue}
                  fastOn={fastOn}
                  fastSupported={fastSupported}
                  onChange={writeAgentDefault}
                  reasoningSupported={reasoningSupported}
                  speedValue={speedValue}
                  ultrafastSupported={ultrafastSupported}
                />
                {mainSettings}
              </>
            ) : (
              mainSettings
            )
          }
          dirty={
            defaultMain.source !== defaultMain.appliedSource ||
            (defaultMain.source === 'aino'
              ? defaultMain.selectedPlatformId !== defaultMain.appliedPlatformId
              : selectedProvider !== mainModel?.provider || selectedModel !== mainModel?.model)
          }
          notice={
            <>
              {errorNotice}
              {switchStaleAux.length > 0 && (
                <div className="mt-2">
                  <StaleAuxWarning
                    applying={applying}
                    onReset={() => void resetAuxiliaryModels()}
                    slots={switchStaleAux}
                    taskLabel={auxiliaryTaskLabel}
                  />
                </div>
              )}
            </>
          }
          onApply={() => void (defaultMain.source === 'aino' ? applyPlatformMainModel() : applyMainModel())}
          onSourceChange={source => {
            invalidateKeyActivation()
            setActivating(false)
            setApiKeyDraft('')
            defaultMain.setSource(source)
          }}
          providerControls={defaultMain.source === 'provider' ? mainSourceControls : null}
          source={defaultMain.source}
        />
      )}
      {fallbackSettings}

      {showAuxiliary && (
        <section className="model-settings-subpage model-settings-auxiliary">
          <div className="model-settings-subpage-heading">
            <div>
              <SectionHeading icon={Cpu} title={m.auxiliaryTitle} />
              <p>{m.auxiliaryDesc}</p>
            </div>
            <Button
              disabled={!mainModel || applying}
              onClick={() => void resetAuxiliaryModels()}
              size="sm"
              variant="outline"
            >
              {m.resetAllToMain}
            </Button>
          </div>
          {(switchStaleAux.length === 0 || !showMain) && persistentStaleAux.length > 0 && !staleAuxDismissed && (
            <div className="mb-2.5">
              <StaleAuxWarning
                applying={applying}
                onDismiss={() => {
                  const mainProvider = mainModel?.provider ?? ''

                  dismissStaleAux(scopeProfile, mainProvider, persistentStaleAux)
                  setDismissedStaleAux(staleAuxFingerprint(mainProvider, persistentStaleAux))
                }}
                onReset={() => void resetAuxiliaryModels()}
                slots={persistentStaleAux}
                taskLabel={auxiliaryTaskLabel}
              />
            </div>
          )}
          <table className="model-settings-aux-table">
            <thead>
              <tr>
                <th scope="col">{m.pages.auxiliaryTask}</th>
                <th scope="col">{m.pages.auxiliaryPurpose}</th>
                <th scope="col">{m.pages.auxiliaryModel}</th>
              </tr>
            </thead>
            <tbody>
              {auxRows.map(meta => {
                const copy = m.tasks[meta.key] ?? { label: meta.label ?? meta.key, hint: meta.hint ?? meta.key }
                const current = auxiliary?.tasks.find(entry => entry.task === meta.key)
                const isAuto = !current || !current.provider || current.provider === 'auto'
                const isEditing = editingAuxTask === meta.key

                return (
                  <tr data-settings-row="" id={`aux-task-${meta.key}`} key={meta.key}>
                    <th scope="row">{copy.label}</th>
                    <td className="model-settings-aux-purpose">{copy.hint}</td>
                    <td>
                      {isEditing ? (
                        <div className="model-settings-aux-editor">
                          <div className="model-settings-aux-editor-controls">
                            <Select
                              onValueChange={value => setAuxDraft(prev => ({ ...prev, provider: value, model: '' }))}
                              value={findCatalogProvider(providers, auxDraft.provider)?.slug ?? auxDraft.provider}
                            >
                              <SelectTrigger
                                aria-label={`${copy.label} provider`}
                                className={cn('w-full min-w-0', CONTROL_TEXT)}
                              >
                                <SelectValue placeholder={m.provider} />
                              </SelectTrigger>
                              <SelectContent>
                                {providerOptions.map(provider => (
                                  <SelectItem key={provider.slug || 'none'} value={provider.slug || 'none'}>
                                    {provider.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <ModelSelect
                              aria-label={`${copy.label} model`}
                              className="w-full min-w-0"
                              models={auxDraftProviderModels}
                              onValueChange={value => setAuxDraft(prev => ({ ...prev, model: value }))}
                              provider={findCatalogProvider(providers, auxDraft.provider)}
                              providerSlug={auxDraft.provider}
                              value={auxDraft.model}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground">{m.reasoning}</span>
                            <Select
                              onValueChange={value => setAuxDraft(prev => ({ ...prev, reasoningEffort: value }))}
                              value={auxDraft.reasoningEffort}
                            >
                              <SelectTrigger
                                aria-label={`${copy.label} reasoning effort`}
                                className={cn('w-full min-w-0', CONTROL_TEXT)}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__inherit__">{m.inheritMainEffort}</SelectItem>
                                {REASONING_EFFORT_VALUES.map(value => (
                                  <SelectItem key={value} value={value}>
                                    {value === 'none' ? m.reasoningOff : t.shell.modelOptions[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              disabled={!auxDraft.provider || !auxDraft.model || applying}
                              onClick={() => void applyAuxiliaryDraft(meta.key)}
                              size="sm"
                            >
                              {applying ? m.applying : t.common.apply}
                            </Button>
                            <Button onClick={() => setEditingAuxTask(null)} size="sm" variant="ghost">
                              {t.common.cancel}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="model-settings-aux-route">
                          <AuxTaskRouteSummary
                            current={current}
                            inheritLabel={meta.inheritFrom ? auxiliaryTaskLabel(meta.inheritFrom) : undefined}
                          />
                          <div className="model-settings-aux-actions">
                            {meta.inheritFrom && !isAuto && (
                              <AuxFollowBaseButton
                                baseLabel={auxiliaryTaskLabel(meta.inheritFrom)}
                                disabled={applying}
                                onFollow={() => void assignAuxiliary(meta.key, AUX_FOLLOW_BASE)}
                              />
                            )}
                            <Button
                              disabled={!mainModel || applying}
                              onClick={() =>
                                mainModel &&
                                void assignAuxiliary(meta.key, auxMainRoute(mainModel, endpointForProvider))
                              }
                              size="sm"
                              variant="text"
                            >
                              {m.setToMain}
                            </Button>
                            <Button
                              disabled={!providers.length || applying}
                              onClick={() => beginAuxiliaryEdit(meta.key)}
                              size="sm"
                              variant="textStrong"
                            >
                              {m.change}
                            </Button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
      {showMoa && moa && currentMoaPreset && (
        <section className="model-settings-subpage model-settings-moa">
          <div className="model-settings-subpage-heading">
            <div>
              <SectionHeading icon={Cpu} title={m.moaTitle} />
              <p>{m.moaDescription}</p>
            </div>
          </div>
          <MoaPresetSettings
            applying={applying}
            currentMoaPreset={currentMoaPreset}
            moa={moa}
            newMoaPresetName={newMoaPresetName}
            saveMoa={saveMoa}
            selectedMoaPreset={selectedMoaPreset}
            setNewMoaPresetName={setNewMoaPresetName}
            setSelectedMoaPreset={setSelectedMoaPreset}
            updateMoaPreset={updateMoaPreset}
          />
          <MoaModelSlots
            applying={applying}
            currentMoaPreset={currentMoaPreset}
            moaSlotProviderOptions={moaSlotProviderOptions}
            modelsForProvider={modelsForProvider}
            providers={providers}
            selectedMoaPreset={selectedMoaPreset}
            updateMoaPreset={updateMoaPreset}
            updateMoaSlot={updateMoaSlot}
          />
        </section>
      )}
      {subpage === 'moa' && !loading && (!moa || !currentMoaPreset) && (
        <PanelEmpty
          action={
            <Button onClick={() => void refresh()} size="sm">
              {t.skills.refresh}
            </Button>
          }
          icon="error"
          title={m.loadFailed}
        />
      )}
    </div>
  )
}

function appliedModelLabels(
  defaults: ReturnType<typeof useDefaultMainModel>,
  main: Parameters<typeof useDefaultMainModel>[0],
  providers: Parameters<typeof findCatalogProvider>[0],
  copy: ReturnType<typeof modelSourceCopy>,
  builtIn: string
) {
  if (defaults.appliedSource === 'aino') {
    return {
      appliedModelLabel: defaults.appliedPlatformModel?.display_name || defaults.appliedPlatformId,
      appliedSourceLabel: builtIn
    }
  }

  const source = defaults.appliedSource === 'custom' ? copy.customSource : copy.providerSource
  const provider = findCatalogProvider(providers, main?.provider || '')?.name || main?.provider || ''

  return { appliedModelLabel: main?.model || '', appliedSourceLabel: `${source} · ${provider}` }
}
