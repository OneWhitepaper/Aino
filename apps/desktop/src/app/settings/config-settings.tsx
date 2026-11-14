import { REASONING_EFFORT_VALUES } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import type { ChangeEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { getElevenLabsVoices, getHermesConfigSchema, saveHermesConfig } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Settings2 } from '@/lib/icons'
import { isSubmitEnter } from '@/lib/ime'
import { asText } from '@/lib/text'
import { confirm } from '@/store/confirm'
import { $activeConnectionId } from '@/store/connections'
import {
  $dataUrlReadMaxMb,
  clampDataUrlReadMaxMb,
  DATA_URL_READ_DEFAULT_MAX_MB,
  DATA_URL_READ_MAX_MAX_MB,
  DATA_URL_READ_MIN_MAX_MB,
  refreshDataUrlReadMaxMb,
  setDataUrlReadMaxMb
} from '@/store/data-url-read-max'
import { recordSettingsSaved } from '@/store/desktop-metrics'
import { $disableF12, setDisableF12 } from '@/store/disable-f12'
import { $alwaysExternalLinks, setAlwaysExternalLinks } from '@/store/external-links'
import { $keepAwakeMode, type KeepAwakeMode, setKeepAwakeMode } from '@/store/keep-awake'
import { refreshMemoryStatus } from '@/store/memory-status'
import { notify, notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import { repoDiscoveryPolicyFromConfig, repoDiscoveryPolicySignature, scanAndRecordRepos } from '@/store/projects'
import { $settingsRequestProfile } from '@/store/settings-scope'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import { hermesConfigCacheWriter, useHermesConfigRecord } from '../hooks/use-config-record'
import { useOnProfileSwitch } from '../hooks/use-on-profile-switch'
import { PanelEmpty } from '../overlays/panel'

import { ConfigField } from './config-field'
import { ConfigPageContent, type ConfigPageSlots } from './config-page-content'
import { configPageCategory, configPageTarget, isConfigPageSection } from './config-page-definitions'
import { ConfigPageField } from './config-page-field'
import { CONFIG_SUBPAGES, configSubpageForField } from './config-subpages'
import { DELEGATION_ROUTE_COMPANION_KEY, DelegationRouteRow } from './delegation-route-row'
import { DelegationRoutingSlot } from './delegation/routing-section'
import { SubagentModelGate } from './delegation/subagent-model-gate'
import {
  clearsEnabledToolsets,
  configFieldValue,
  diffConfig,
  enumOptionsFor,
  getNested,
  isExternalMemoryProvider,
  sectionFieldEntries,
  setConfigField,
  voiceFieldVisible
} from './helpers'
import { MemoryConnect } from './memory/connect'
import { MemoryLayersSlot } from './memory/memory-layers'
import { ProviderConfigPanel } from './memory/provider-config-panel'
import { ModelImageGenerationSettings } from './model-image-generation-settings'
import { ModelSettings, ModelSettingsSkeleton } from './model-settings'
import { ModelSettingsNavigation } from './model-settings-navigation'
import { OnboardingSettings } from './onboarding-settings'
import { PoolLimitsSetting } from './pool-limits-setting'
import {
  EmptyState,
  ListRow,
  SectionHeading,
  SettingsContent,
  SettingsGroup,
  SettingsSkeleton,
  ToggleRow
} from './primitives'
import { SettingsProfileScope } from './profile-scope'
import { QuickEntrySettings } from './quick-entry-settings'
import { SETTING_IDS, settingElementId } from './settings-manifest'
import { SharedMetricsSettings } from './shared-metrics-settings'
import { resolveSettingsSubpage, settingsSubpageForLegacyLink, settingsSubpageIcon } from './subpages'
import { useSettingDeepLink } from './use-setting-deep-link'
import { WORKSPACE_FIELD_KEYS, WorkspaceSettings } from './workspace-settings'

export function ConfigSettings({
  activeSectionId,
  afterContent,
  subpage,
  onConfigSaved,
  onMainModelChanged,
  importInputRef,
  importFile,
  onImportConsumed
}: ConfigSettingsProps) {
  // Shared "Applies to" scope (null → the app's active profile). Remount the
  // inner page per scope so every draft/seed/autosave ref resets wholesale
  // when the target profile changes — the same guarantee useOnProfileSwitch
  // provides for app-wide switches, without hand-clearing each piece.
  const scopeProfile = useStore($settingsRequestProfile)
  const connectionId = useStore($activeConnectionId)
  const [searchParams, setSearchParams] = useSearchParams()
  const showModelNavigation = activeSectionId === 'model' && subpage === undefined
  const modelSubpage = showModelNavigation ? resolveSettingsSubpage('config:model', searchParams) : subpage

  const legacyModelPage = showModelNavigation ? settingsSubpageForLegacyLink('config:model', searchParams) : undefined

  const configPage =
    isConfigPageSection(activeSectionId) && subpage === undefined
      ? configPageTarget(activeSectionId, searchParams)
      : undefined

  const canonicalPage = configPage ?? legacyModelPage

  // Keep the scoped draft mounted while normalizing links. Returning a
  // redirect here would cancel a pending autosave on every section switch.
  useEffect(() => {
    if (canonicalPage && searchParams.get('page') !== canonicalPage) {
      setSearchParams(
        previous => {
          const next = new URLSearchParams(previous)
          next.set('page', canonicalPage)

          return next
        },
        { replace: true }
      )
    }
  }, [canonicalPage, searchParams, setSearchParams])

  return (
    <ConfigSettingsInner
      activeSectionId={activeSectionId}
      afterContent={
        <ModelImageGenerationSettings activeSectionId={activeSectionId} profile={scopeProfile} subpage={modelSubpage}>
          {afterContent}
        </ModelImageGenerationSettings>
      }
      importFile={importFile}
      importInputRef={importInputRef}
      key={JSON.stringify([connectionId, scopeProfile ?? '__active__'])}
      onConfigSaved={onConfigSaved}
      onImportConsumed={onImportConsumed}
      onMainModelChanged={onMainModelChanged}
      scopeProfile={scopeProfile}
      showModelNavigation={showModelNavigation}
      subpage={modelSubpage}
    />
  )
}

interface ConfigSettingsProps {
  activeSectionId: string
  afterContent?: ReactNode
  /** An explicit subpage keeps embedded consumers on that page without navigation. */
  subpage?: string
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
  importInputRef: React.RefObject<HTMLInputElement | null>
  /** A shell-selected file is handled by the same scoped draft and autosave owner. */
  importFile?: File
  onImportConsumed?: (file: File) => void
}

function useConfigImport(
  config: HermesConfigRecord | null,
  schema: Record<string, ConfigFieldSchema> | null,
  onImport: (config: HermesConfigRecord, isCurrent: () => boolean) => void,
  importFile?: File,
  onImportConsumed?: (file: File) => void
) {
  const { t } = useI18n()
  const c = t.settings.config
  const ready = Boolean(config && schema)

  const state = useRef({
    generation: 0,
    read: null as null | { file: File; external: boolean; cancel: () => void },
    consumed: new WeakSet<File>()
  }).current

  useEffect(
    () => () => {
      state.generation += 1
      state.read?.cancel()
      state.read = null
    },
    [state]
  )

  const readImport = useCallback(
    (file: File, external = false) => {
      state.read?.cancel()
      state.generation += 1
      const generation = state.generation
      const connectionId = $activeConnectionId.get()
      const requestProfile = $settingsRequestProfile.get()
      const activeProfile = $activeGatewayProfile.get()
      const reader = new FileReader()
      let cancelled = false

      const isCurrent = () =>
        !cancelled &&
        generation === state.generation &&
        connectionId === $activeConnectionId.get() &&
        requestProfile === $settingsRequestProfile.get() &&
        activeProfile === $activeGatewayProfile.get()

      const finish = (apply: () => void) => {
        if (!isCurrent()) {
          return
        }

        state.read = null

        if (external) {
          state.consumed.add(file)
        }

        apply()

        if (external) {
          onImportConsumed?.(file)
        }
      }

      reader.onload = () =>
        finish(() => {
          try {
            onImport(JSON.parse(String(reader.result)), isCurrent)
            notify({ kind: 'success', title: c.imported, message: t.common.saving })
          } catch (err) {
            notifyError(err, c.invalidJson)
          }
        })
      reader.onerror = () => finish(() => notifyError(reader.error, c.invalidJson))
      state.read = {
        file,
        external,
        cancel: () => {
          cancelled = true
          reader.onload = null
          reader.onerror = null

          if (reader.readyState === FileReader.LOADING) {
            reader.abort()
          }
        }
      }
      reader.readAsText(file)
    },
    [c.imported, c.invalidJson, onImport, onImportConsumed, state, t.common.saving]
  )

  useEffect(() => {
    if (state.read?.external && state.read.file !== importFile) {
      state.read.cancel()
      state.read = null
    }

    if (!ready || !importFile || state.consumed.has(importFile) || state.read?.file === importFile) {
      return
    }

    readImport(importFile, true)
  }, [importFile, readImport, ready, state])

  return (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!ready || !file) {
      return
    }

    readImport(file)
    event.target.value = ''
  }
}

interface ConfigSettingsLoadStateProps {
  afterContent?: ReactNode
  configAvailable: boolean
  schemaAvailable: boolean
  configLoadFailed: boolean
  schemaFailed: boolean
  refetchConfig: () => unknown
  refetchSchema: () => unknown
  showModelSettings: boolean
  showSharedMetrics: boolean
  showDesktopSettings: boolean
  inline?: boolean
  subpage?: string
}

function ConfigSettingsLoadState({
  afterContent,
  configAvailable,
  schemaAvailable,
  configLoadFailed,
  schemaFailed,
  refetchConfig,
  refetchSchema,
  showModelSettings,
  showSharedMetrics,
  showDesktopSettings,
  subpage,
  inline
}: ConfigSettingsLoadStateProps) {
  const { t } = useI18n()
  const c = t.settings.config

  // A failed config/schema fetch must surface a retry, not spin forever.
  if ((configLoadFailed && !configAvailable) || (schemaFailed && !schemaAvailable)) {
    const emptyState = (
      <div className="flex h-full min-h-0 flex-1">
        <PanelEmpty
          action={
            <Button
              onClick={() => {
                void refetchConfig()
                void refetchSchema()
              }}
              size="sm"
            >
              {t.skills.refresh}
            </Button>
          }
          icon="error"
          title={c.failedLoad}
        />
      </div>
    )

    if (inline) {
      return <div className="config-page-load-error">{emptyState}</div>
    }

    return afterContent ? (
      <SettingsContent>
        <div className="flex min-h-64">{emptyState}</div>
        {afterContent}
      </SettingsContent>
    ) : (
      emptyState
    )
  }

  if (inline) {
    return (
      <div aria-label={t.common.loading} className="config-page-loading" role="status">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  // Every section keeps its shape via a skeleton; model gets its bespoke one
  // (its catalog fetch is the slow part), the rest the shared field rhythm.
  if (showModelSettings) {
    return (
      <SettingsContent>
        <SettingsProfileScope className="mb-5" />
        {showSharedMetrics && <SharedMetricsSettings />}
        {showDesktopSettings && <OnboardingSettings />}
        <div className="mb-6">
          <ModelSettingsSkeleton subpage={subpage} />
        </div>
        {afterContent}
      </SettingsContent>
    )
  }

  return <SettingsSkeleton afterContent={afterContent} sections={[{ rows: 6 }]} />
}

interface ConfigFieldDeepLinkProps {
  activeSectionId: string
  config: HermesConfigRecord | null
  schema: Record<string, ConfigFieldSchema> | null
  subpage?: string
}

function useConfigFieldDeepLink({ activeSectionId, config, schema, subpage }: ConfigFieldDeepLinkProps) {
  const unifiedPage = isConfigPageSection(activeSectionId)
  const [searchParams, setSearchParams] = useSearchParams()
  const targetField = searchParams.get('field')

  useSettingDeepLink(
    `config:${activeSectionId}`,
    page =>
      activeSectionId !== 'workspace' &&
      (unifiedPage && subpage === undefined
        ? configPageCategory(activeSectionId, page) === searchParams.get('page')
        : subpage === undefined || page === subpage)
  )

  useEffect(() => {
    // Model fields mount inside the asynchronously loaded model controller,
    // which owns their highlight once its content is ready.
    if (
      !targetField ||
      !config ||
      !schema ||
      (unifiedPage &&
        subpage === undefined &&
        searchParams.get('page') !== configPageTarget(activeSectionId, searchParams)) ||
      (activeSectionId === 'workspace' && WORKSPACE_FIELD_KEYS.has(targetField)) ||
      (activeSectionId === 'model' && subpage === undefined)
    ) {
      return
    }

    const element = document.getElementById(
      `setting-field-${targetField === DELEGATION_ROUTE_COMPANION_KEY ? 'delegation.model' : targetField}`
    )

    if (!element) {
      return
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' })

    if (!element.hasAttribute('tabindex')) {
      element.tabIndex = -1
    }

    element.focus({ preventScroll: true })
    element.classList.add('setting-field-highlight')

    const timeout = window.setTimeout(() => element.classList.remove('setting-field-highlight'), 1600)

    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous)
        next.delete('field')

        return next
      },
      { replace: true }
    )

    return () => window.clearTimeout(timeout)
  }, [activeSectionId, config, schema, searchParams, setSearchParams, subpage, targetField, unifiedPage])
}

interface ConfigPagePresentationProps {
  activeSectionId: string
  afterContent?: ReactNode
  subpage?: string
  fields: [string, ConfigFieldSchema][]
  config: HermesConfigRecord | null
}

/** Compose device controls and field visibility without changing the scoped config draft. */
function useConfigPagePresentation({
  activeSectionId,
  afterContent,
  subpage,
  fields,
  config
}: ConfigPagePresentationProps) {
  const { t } = useI18n()
  const c = t.settings.config
  const keepAwakeMode = useStore($keepAwakeMode)

  const keepAwakeOptions = [
    { id: 'off', label: c.keepAwakeOff },
    { id: 'while-working', label: c.keepAwakeWhileWorking },
    { id: 'always', label: c.keepAwakeAlways }
  ] as const satisfies readonly { id: KeepAwakeMode; label: string }[]

  const disableF12 = useStore($disableF12)
  const alwaysExternalLinks = useStore($alwaysExternalLinks)

  const showModelSettings =
    activeSectionId === 'model' && (subpage === undefined || ['main', 'auxiliary', 'moa'].includes(subpage))

  const showDesktopSettings = activeSectionId === 'advanced' && (subpage === undefined || subpage === 'desktop')

  const showAttachments = activeSectionId === 'chat' && (subpage === undefined || subpage === 'attachments')
  const showSharedMetrics = activeSectionId === 'safety' && (subpage === undefined || subpage === 'privacy')

  const pageSlots: ConfigPageSlots = {
    after: afterContent,
    attachments: showAttachments ? <AttachmentSizeSetting /> : undefined,
    desktop: showDesktopSettings ? (
      <>
        <ListRow
          action={<SegmentedControl onChange={setKeepAwakeMode} options={keepAwakeOptions} value={keepAwakeMode} />}
          description={c.keepAwakeDesc}
          id={settingElementId(SETTING_IDS.advanced.keepAwake)}
          title={c.keepAwakeTitle}
        />
        <ToggleRow
          checked={disableF12}
          description={c.disableF12Desc}
          id={settingElementId(SETTING_IDS.advanced.disableF12)}
          label={c.disableF12Title}
          onChange={setDisableF12}
        />
        <ToggleRow
          checked={alwaysExternalLinks}
          description={c.alwaysExternalLinksDesc}
          label={c.alwaysExternalLinksTitle}
          onChange={setAlwaysExternalLinks}
        />
      </>
    ) : undefined,
    connections: activeSectionId === 'advanced' ? <PoolLimitsSetting presentation="page" /> : undefined,
    quickEntry: showDesktopSettings ? <QuickEntrySettings /> : undefined,
    onboarding: showDesktopSettings ? <OnboardingSettings /> : undefined,
    metrics: showSharedMetrics ? <SharedMetricsSettings /> : undefined,
    voiceHint:
      activeSectionId === 'voice' ? (
        <ListRow description={c.voiceShortcutHintDesc} title={c.voiceShortcutHintTitle} />
      ) : undefined
  }

  const visibleFields = (
    activeSectionId === 'voice' && config ? fields.filter(([key]) => voiceFieldVisible(key, config)) : fields
  ).filter(([key]) => key !== DELEGATION_ROUTE_COMPANION_KEY)

  return {
    showModelSettings,
    showDesktopSettings,
    showAttachments,
    showSharedMetrics,
    pageSlots,
    visibleFields
  }
}

function ConfigSettingsInner({
  activeSectionId,
  afterContent,
  subpage,
  onConfigSaved,
  onMainModelChanged,
  importInputRef,
  importFile,
  onImportConsumed,
  scopeProfile,
  showModelNavigation
}: ConfigSettingsProps & { scopeProfile: string | undefined; showModelNavigation: boolean }) {
  const { t } = useI18n()
  const c = t.settings.config
  // The editable draft is local (debounced autosave watches it), but it's seeded
  // from — and saved back through — the shared config cache, so edits are visible
  // in the MCP/model surfaces and reopening the page doesn't reload-flash.
  const [config, setConfig] = useState<HermesConfigRecord | null>(null)

  const {
    data: loadedConfig,
    isError: configLoadFailed,
    refetch: refetchConfig,
    writeScope
  } = useHermesConfigRecord(scopeProfile)

  // Writes land on the same cache key the query above reads (base key when
  // following the active profile, suffixed when a scope override is set).
  const writeConfigCache = useMemo(() => hermesConfigCacheWriter(scopeProfile), [scopeProfile])

  const {
    data: schemaResponse,
    isError: schemaFailed,
    refetch: refetchSchema
  } = useQuery({
    // Base key when following the active profile (matches every pre-existing
    // consumer); suffixed only for an explicit scope override.
    queryKey:
      scopeProfile == null ? ['hermes-config-schema'] : ['hermes-config-schema', normalizeProfileKey(scopeProfile)],
    queryFn: () => getHermesConfigSchema(scopeProfile),
    staleTime: 5 * 60 * 1000
  })

  const schema = schemaResponse?.fields ?? null
  const [elevenLabsVoiceOptions, setElevenLabsVoiceOptions] = useState<string[] | null>(null)
  const [elevenLabsVoiceLabels, setElevenLabsVoiceLabels] = useState<Record<string, string>>({})
  const saveVersionRef = useRef(0)
  const savedDiscoverySignatureRef = useRef<string | undefined>(undefined)
  const [saveVersion, setSaveVersion] = useState(0)

  // Seed the local draft once, the first time the shared record lands.
  // Background refetches thereafter must not clobber in-progress edits.
  const configSeeded = useRef(false)
  // Snapshot of the record as it was when the draft was seeded. Autosave
  // diffs the draft against this (not against disk) so a field the user
  // never touched — possibly changed out-of-band by `hermes config set`
  // while this page sat open — is never resent with its stale value.
  const configBaselineRef = useRef<HermesConfigRecord | null>(null)
  // Serializes autosave requests so an older save that's still in flight can't
  // resolve after a newer one and re-advance the baseline / cache with stale
  // data — each save's diff+request only starts once the previous one lands.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (loadedConfig && !configSeeded.current) {
      configSeeded.current = true
      configBaselineRef.current = loadedConfig
      savedDiscoverySignatureRef.current = repoDiscoveryPolicySignature(repoDiscoveryPolicyFromConfig(loadedConfig))
      setConfig(loadedConfig)
    }
  }, [loadedConfig])

  // A profile switch invalidates (but doesn't clear) the shared config query, so
  // the local draft would otherwise keep profile A's data and autosave it into
  // B. Drop the seed + draft (re-seeds from B's refetch) and zero saveVersion so
  // the pending debounced autosave is cancelled by its effect cleanup.
  useOnProfileSwitch(() => {
    configSeeded.current = false
    configBaselineRef.current = null
    savedDiscoverySignatureRef.current = undefined
    setConfig(null)
    saveVersionRef.current = 0
    setSaveVersion(0)
    saveQueueRef.current = Promise.resolve()
  })

  useEffect(() => {
    let cancelled = false

    getElevenLabsVoices(scopeProfile)
      .then(result => {
        if (cancelled || !result.available) {
          return
        }

        setElevenLabsVoiceOptions(result.voices.map(voice => voice.voice_id))
        setElevenLabsVoiceLabels(Object.fromEntries(result.voices.map(voice => [voice.voice_id, voice.label])))
      })
      .catch(() => {
        if (!cancelled) {
          setElevenLabsVoiceOptions(null)
          setElevenLabsVoiceLabels({})
        }
      })

    return () => void (cancelled = true)
    // scopeProfile is constant per mount (the inner component is keyed on it).
  }, [scopeProfile])

  // eslint-disable-next-line no-restricted-syntax -- autosave bookkeeping refs, not an atom mirror
  useEffect(() => {
    if (!config || saveVersion === 0) {
      return
    }

    const v = saveVersion
    const snapshot = config

    const discoveryProfile = normalizeProfileKey(writeScope?.profile ?? scopeProfile ?? $activeGatewayProfile.get())

    const discoveryConnectionId = writeScope?.connectionId ?? $activeConnectionId.get()

    const t = window.setTimeout(() => {
      // Chained onto the queue (not fired directly) so an older save that's
      // still awaiting its response can't land after this one and undo its
      // baseline advance — each save's diff is computed once its predecessor
      // has fully resolved.
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const patch = diffConfig(configBaselineRef.current ?? {}, snapshot)
          const result = await saveHermesConfig(patch, writeScope ?? scopeProfile)

          if (!result.ok) {
            throw new Error(c.autosaveFailed)
          }

          // The saved snapshot becomes the new baseline, so the next autosave
          // diffs against what's actually on disk instead of the page-load
          // (or last-baseline) copy — otherwise reverting a field to its
          // pre-save value diffs to nothing and the revert never reaches disk.
          configBaselineRef.current = snapshot

          // Mirror the saved record into the shared cache so MCP/model surfaces
          // reflect the edit without their own refetch.
          writeConfigCache(snapshot)
          const savedScope = writeScope ?? scopeProfile

          recordSettingsSaved(patch, schema ?? {}, typeof savedScope === 'string' ? savedScope : savedScope?.profile)

          // The Memory summary's "active" provider is the saved one; reread it.
          if ('memory' in patch) {
            refreshMemoryStatus()
          }

          if (saveVersionRef.current === v) {
            // Scanning resolves the live workspace; only refresh when the
            // saved owner still matches it, including concrete active scopes.
            if (
              normalizeProfileKey($activeGatewayProfile.get()) === discoveryProfile &&
              $activeConnectionId.get() === discoveryConnectionId
            ) {
              const discoverySignature = repoDiscoveryPolicySignature(repoDiscoveryPolicyFromConfig(snapshot))

              if (savedDiscoverySignatureRef.current !== discoverySignature) {
                savedDiscoverySignatureRef.current = discoverySignature
                await scanAndRecordRepos(true)
              }
            }

            onConfigSaved?.()
          }
        } catch (err) {
          if (saveVersionRef.current === v) {
            notifyError(err, c.autosaveFailed)
          }
        }
      })
    }, 550)

    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- copy is stable; avoid re-scheduling autosave on locale change
  }, [config, onConfigSaved, saveVersion, writeScope, scopeProfile])

  const applyConfig = (next: HermesConfigRecord) => {
    saveVersionRef.current += 1
    setConfig(next)
    setSaveVersion(saveVersionRef.current)
  }

  const updateConfig = (next: HermesConfigRecord, isCurrent = () => true) => {
    // Guard the single most destructive config edit: clearing the entire
    // "Enabled Toolsets" list silently disables memory, terminal, web search,
    // delegation, and most tools, and a stray select-all + Backspace can do it.
    // Auto-save is debounced with no undo, so confirm a non-empty → empty
    // transition before applying it. Every other edit passes through untouched.
    if (config && clearsEnabledToolsets(config, next)) {
      void confirm({ destructive: true, title: c.toolsetsWipeConfirm }).then(ok => {
        if (ok && isCurrent()) {
          applyConfig(next)
        }
      })

      return
    }

    applyConfig(next)
  }

  const sectionFields = useMemo(() => {
    if (!schema || !config) {
      return new Map<string, [string, ConfigFieldSchema][]>()
    }

    return sectionFieldEntries(schema, config)
  }, [schema, config])

  const unifiedPage = isConfigPageSection(activeSectionId)

  const fields = (sectionFields.get(activeSectionId) ?? []).filter(([key]) => {
    if (subpage === undefined) {
      return true
    }

    const group = configSubpageForField(activeSectionId, key)

    return unifiedPage
      ? configPageCategory(activeSectionId, group) === configPageCategory(activeSectionId, subpage)
      : group === subpage
  })

  useConfigFieldDeepLink({ activeSectionId, config, schema, subpage })

  const handleImport = useConfigImport(config, schema, updateConfig, importFile, onImportConsumed)

  const { showModelSettings, showDesktopSettings, showAttachments, showSharedMetrics, pageSlots, visibleFields } =
    useConfigPagePresentation({ activeSectionId, afterContent, subpage, fields, config })

  const FieldControl = unifiedPage ? ConfigPageField : ConfigField

  const renderFieldGroup = (entries: [string, ConfigFieldSchema][], extra?: ReactNode) => {
    if (!config || !schema) {
      return extra ? <SettingsGroup>{extra}</SettingsGroup> : null
    }

    return (
      <SettingsGroup>
        {extra}
        {entries.some(([key]) => key === 'memory.provider') && (
          <MemoryLayersSlot
            builtin={{
              memory: getNested(config, 'memory.memory_enabled') !== false,
              user: getNested(config, 'memory.user_profile_enabled') !== false
            }}
            profile={scopeProfile}
            provider={asText(getNested(config, 'memory.provider'))}
            sectionId={activeSectionId}
            subpage="persistent"
          />
        )}
        {entries.map(([key, field]) => (
          <div className="scroll-mt-6" data-settings-row="" id={`setting-field-${key}`} key={key}>
            {key === 'delegation.model' ? (
              <SubagentModelGate scope={writeScope ?? scopeProfile}>
                <DelegationRouteRow config={config} onConfigChange={updateConfig} scope={writeScope ?? scopeProfile} />
              </SubagentModelGate>
            ) : (
              <FieldControl
                descriptionExtra={
                  key === 'memory.provider' && isExternalMemoryProvider(getNested(config, key)) ? (
                    <MemoryConnect profile={scopeProfile} provider={String(getNested(config, key))} />
                  ) : undefined
                }
                enumOptions={
                  key === 'tts.elevenlabs.voice_id'
                    ? enumOptionsFor(key, getNested(config, key), config, elevenLabsVoiceOptions ?? undefined)
                    : enumOptionsFor(
                        key,
                        getNested(config, key),
                        config,
                        key === 'context.engine' ? field.options?.map(String) : undefined
                      )
                }
                onChange={value => updateConfig(setConfigField(config, key, value))}
                optionLabels={
                  key === 'tts.elevenlabs.voice_id'
                    ? elevenLabsVoiceLabels
                    : key === 'delegation.reasoning_effort'
                      ? Object.fromEntries([
                          ['', t.settings.model.inheritMainEffort],
                          ...REASONING_EFFORT_VALUES.map(value => [
                            value,
                            value === 'none' ? t.settings.model.reasoningOff : t.shell.modelOptions[value]
                          ])
                        ])
                      : undefined
                }
                schema={
                  key === 'delegation.reasoning_effort'
                    ? { ...field, description: t.settings.model.defaultMain.reasoningDescription }
                    : field
                }
                schemaKey={key}
                value={configFieldValue(config, key)}
              />
            )}
            {key === 'memory.provider' && isExternalMemoryProvider(getNested(config, key)) ? (
              <ProviderConfigPanel
                key={String(getNested(config, key))}
                profile={scopeProfile}
                provider={String(getNested(config, key))}
              />
            ) : null}
          </div>
        ))}
      </SettingsGroup>
    )
  }

  if (unifiedPage) {
    return (
      <SettingsContent>
        <ConfigPageContent
          fields={visibleFields}
          renderFields={renderFieldGroup}
          section={activeSectionId}
          slots={pageSlots}
          status={
            !config || !schema ? (
              <ConfigSettingsLoadState
                configAvailable={Boolean(config)}
                configLoadFailed={configLoadFailed}
                inline
                refetchConfig={refetchConfig}
                refetchSchema={refetchSchema}
                schemaAvailable={Boolean(schema)}
                schemaFailed={schemaFailed}
                showDesktopSettings={false}
                showModelSettings={false}
                showSharedMetrics={false}
              />
            ) : undefined
          }
          subpage={subpage}
        >
          <input
            accept=".json,application/json"
            className="hidden"
            disabled={!config || !schema}
            onChange={handleImport}
            ref={importInputRef}
            type="file"
          />
        </ConfigPageContent>
      </SettingsContent>
    )
  }

  if (!config || !schema) {
    return (
      <ConfigSettingsLoadState
        afterContent={afterContent}
        configAvailable={Boolean(config)}
        configLoadFailed={configLoadFailed}
        refetchConfig={refetchConfig}
        refetchSchema={refetchSchema}
        schemaAvailable={Boolean(schema)}
        schemaFailed={schemaFailed}
        showDesktopSettings={showDesktopSettings}
        showModelSettings={showModelSettings}
        showSharedMetrics={showSharedMetrics}
        subpage={subpage}
      />
    )
  }

  if (activeSectionId === 'workspace') {
    const additionalFields = visibleFields.filter(([key]) => !WORKSPACE_FIELD_KEYS.has(key))

    return (
      <SettingsContent>
        <SettingsProfileScope className="mb-5" />
        {visibleFields.length > 0 ? (
          <WorkspaceSettings config={config} fields={visibleFields} onConfigChange={updateConfig} subpage={subpage} />
        ) : (
          <EmptyState description={c.emptyDesc} title={c.emptyTitle} />
        )}
        {additionalFields.length > 0 && renderFieldGroup(additionalFields)}
        {afterContent}
        <input
          accept=".json,application/json"
          className="hidden"
          onChange={handleImport}
          ref={importInputRef}
          type="file"
        />
      </SettingsContent>
    )
  }

  // Reuse the subpage categories as sections within one scrollable page.
  const groupedFields = new Map<string, [string, ConfigFieldSchema][]>()

  for (const entry of visibleFields) {
    const id = configSubpageForField(activeSectionId, entry[0]) ?? '__other__'
    const entries = groupedFields.get(id) ?? []
    entries.push(entry)
    groupedFields.set(id, entries)
  }

  const extraControls: Record<string, ReactNode> = {
    delegation: (
      <DelegationRoutingSlot
        readScope={scopeProfile}
        sectionId={activeSectionId}
        subpage={subpage}
        writeScope={writeScope}
      />
    )
  }

  const inlineModelFields = activeSectionId === 'model' && ['main', undefined].includes(subpage)
  const groupContent = new Map<string, ReactNode>()

  const visibleGroups = (CONFIG_SUBPAGES[activeSectionId] ?? []).filter(
    group => subpage === undefined || group.id === subpage
  )

  for (const group of visibleGroups) {
    const entries = groupedFields.get(group.id) ?? []
    const extra = extraControls[group.id]

    if (entries.length === 0 && !extra) {
      continue
    }

    groupContent.set(
      group.id,
      <section
        className={activeSectionId === 'model' ? 'model-settings-schema mb-6 scroll-mt-6' : 'mb-6 scroll-mt-6'}
        id={`setting-section-${group.id}`}
        key={group.id}
      >
        {subpage === undefined && !(inlineModelFields && group.id === 'main') && (
          <SectionHeading icon={settingsSubpageIcon(group, Settings2)} title={t.settings.subpages[group.labelKey]} />
        )}
        {renderFieldGroup(entries, extra)}
      </section>
    )
  }

  // Curated fields added before their category metadata still remain editable.
  const ungroupedFields = groupedFields.get('__other__') ?? []

  const showEmptyState = visibleFields.length === 0 && !showModelSettings && !showDesktopSettings && !showAttachments

  return (
    <SettingsContent>
      {showModelNavigation ? (
        <div className="model-settings-context">
          <p>{t.settings.model.pages.description}</p>
          <SettingsProfileScope className="model-settings-scope ml-auto w-fit" compact />
        </div>
      ) : (
        <SettingsProfileScope className="mb-5" />
      )}
      <ModelSettingsNavigation enabled={showModelNavigation} value={subpage}>
        {showSharedMetrics && <SharedMetricsSettings />}
        {showDesktopSettings && <OnboardingSettings />}
        {activeSectionId === 'voice' && (
          <ListRow description={c.voiceShortcutHintDesc} title={c.voiceShortcutHintTitle} />
        )}
        {activeSectionId === 'model' && (
          <div className={showModelSettings ? 'mb-6' : undefined}>
            <ModelSettings
              fallbackSettings={inlineModelFields ? groupContent.get('fallbacks') : undefined}
              mainSettings={inlineModelFields ? groupContent.get('main') : undefined}
              onMainModelChanged={onMainModelChanged}
              scopeProfile={scopeProfile}
              subpage={subpage}
            />
          </div>
        )}
        {[...groupContent].map(([id, content]) =>
          inlineModelFields && (id === 'main' || id === 'fallbacks') ? null : content
        )}
        {ungroupedFields.length > 0 && renderFieldGroup(ungroupedFields)}
        {showEmptyState && <EmptyState description={c.emptyDesc} title={c.emptyTitle} />}
        {afterContent}
        <input
          accept=".json,application/json"
          className="hidden"
          onChange={handleImport}
          ref={importInputRef}
          type="file"
        />
      </ModelSettingsNavigation>
    </SettingsContent>
  )
}

/** Free-form MB cap for Desktop's data-URL attach/preview path (main-process). */
function AttachmentSizeSetting() {
  const { t } = useI18n()
  const c = t.settings.config
  const stored = useStore($dataUrlReadMaxMb)
  const [draft, setDraft] = useState(String(stored))

  useEffect(() => {
    void refreshDataUrlReadMaxMb()
  }, [])

  useEffect(() => {
    setDraft(String(stored))
  }, [stored])

  const commit = () => {
    // An empty draft means "reset to the default", not the 1 MB floor
    // (Number('') === 0 would otherwise clamp down to the floor).
    const applied = draft.trim() === '' ? DATA_URL_READ_DEFAULT_MAX_MB : clampDataUrlReadMaxMb(draft)

    // Unchanged: snap the draft back to the stored value and skip the
    // pointless IPC write + haptic.
    if (applied === stored) {
      setDraft(String(stored))

      return
    }

    void setDataUrlReadMaxMb(applied).then(next => {
      setDraft(String(next))

      // On a bridge write failure the store keeps the old value; only
      // celebrate when the new cap actually landed.
      if (next === applied) {
        triggerHaptic('selection')
      }
    })
  }

  return (
    <ListRow
      action={
        <div className="flex items-center gap-2">
          <Input
            aria-label={c.attachmentSizeLabel}
            className="w-20"
            inputMode="numeric"
            max={DATA_URL_READ_MAX_MAX_MB}
            min={DATA_URL_READ_MIN_MAX_MB}
            onBlur={commit}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.currentTarget.blur()
              }
            }}
            type="number"
            value={draft}
          />
          <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {c.attachmentSizeUnit}
          </span>
        </div>
      }
      description={c.attachmentSizeDesc}
      id={settingElementId(SETTING_IDS.chat.attachmentSize)}
      title={c.attachmentSizeTitle}
    />
  )
}
