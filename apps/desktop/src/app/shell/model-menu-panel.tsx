import './model-menu.css'

import type { ModelOptionProvider, ModelOptionsResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useContext, useMemo, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { usePlatformModels } from '@/components/platform-model-list'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuItem, dropdownMenuRow } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { modelMenuPreviewCopy } from '@/i18n/model-menu-preview'
import { catalogProviderMatches, modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { managedModelSwitchBlocked } from '@/lib/model-switch-policy'
import { cn } from '@/lib/utils'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { collapseModelFamilies } from '@/store/model-visibility'
import { $currentModelSource } from '@/store/session'

import type { PlatformModel } from '../../../shared/platform-contract'

import { LocalSetupMenuRow } from './local-setup-menu-row'
import { ModelCatalogMenu, ModelMenuCloseContext, ModelMenuOpenInstanceContext } from './model-catalog-menu'
import { type ModelMenuPreview, ModelMenuPreviewContext, ModelMenuPreviewDetails } from './model-menu-preview'
import { type ModelMenuHostProps, useModelMenuController } from './use-model-menu-controller'

export { ModelMenuCloseContext } from './model-catalog-menu'
export type { ModelSelection } from './use-model-menu-controller'

interface ModelMenuPanelProps extends ModelMenuHostProps {
  /** Drop the sticky composer pick so new chats follow Settings → Model. */
  onFollowDefaultModel?: () => void
}

/**
 * The composer's model menu: `ModelCatalogMenu` (the shared renderer) plus the
 * controller that gives a selection its meaning HERE (`useModelMenuController`).
 */
export function ModelMenuPanel({ onFollowDefaultModel, ...props }: ModelMenuPanelProps) {
  const { gateway, ownerConnectionId, profile = 'default', requestGateway } = props
  const { t, locale } = useI18n()
  const copy = t.shell.modelMenu
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()

  const { activePlatformModel, activeSessionId, controller, defaultEffort, modelOptions } =
    useModelMenuController(props)

  const view = useSessionView()
  const modelSource = useStore($currentModelSource)
  const pinnedDraft = view.kind === 'primary' && !activeSessionId && modelSource === 'manual'
  // Details, built-in checks and custom rows share the same authoritative pair:
  // this surface's reported selection, then its session-scoped options response.
  const { model: currentModel, provider: currentProvider } = controller.current
  const busy = useStore(view.$busy)
  const awaiting = useStore(view.$awaitingResponse)
  const closeMenu = useContext(ModelMenuCloseContext)
  const managedCapabilities = useStore($gatewayManagedCapabilities)

  const managedCapability = managedModelRouteCapabilityFrom(managedCapabilities, {
    connectionId: ownerConnectionId,
    profile
  })

  const blocked = managedModelSwitchBlocked(currentProvider, '', busy || awaiting)
  const builtinBlocked = managedModelSwitchBlocked(currentProvider, 'aino', busy || awaiting)
  const platform = usePlatformModels()
  const previewCopy = modelMenuPreviewCopy(locale)
  const readOpenInstance = useContext(ModelMenuOpenInstanceContext)
  const scope = `${ownerConnectionId ?? ''}:${profile}:${activeSessionId ?? ''}`
  const [preview, setPreview] = useState<{ scope: string; entry: ModelMenuPreview } | null>(null)
  const [detailScope, setDetailScope] = useState<string | null>(null)
  const showDetail = detailScope === scope
  const layoutRef = useRef<HTMLDivElement>(null)

  const previewKey = (entry: ModelMenuPreview) =>
    entry.kind === 'aino' ? `aino:${entry.model.id}` : `${entry.provider.slug}:${entry.family.id}`

  const onPreview = useCallback(
    (entry: ModelMenuPreview) => {
      setPreview(previous =>
        previous?.scope === scope && previewKey(previous.entry) === previewKey(entry) ? previous : { scope, entry }
      )
    },
    [scope]
  )

  const onInspect = useCallback(
    (entry: ModelMenuPreview) => {
      onPreview(entry)
      setDetailScope(window.innerWidth <= 640 ? scope : null)
      requestAnimationFrame(() => layoutRef.current?.querySelector<HTMLElement>('.aino-model-menu-detail')?.focus())
    },
    [onPreview, scope]
  )

  const presentation = useMemo(() => ({ onPreview, onInspect }), [onInspect, onPreview])

  const initialPreview = initialModelPreview(
    currentModel,
    currentProvider,
    platform.models,
    modelOptions.data?.providers ?? []
  )

  const entry = preview?.scope === scope ? preview.entry : initialPreview
  const inspected = latestModelPreview(entry, platform.models, modelOptions.data?.providers ?? [])

  const backToList = () => {
    setDetailScope(null)
    layoutRef.current?.querySelector<HTMLInputElement>('[data-slot="dropdown-menu-search"] input')?.focus()
  }

  // Explicit "Refresh Models": re-fetch the catalog with refresh:true so the
  // backend busts its 1h provider-model disk cache and re-pulls each provider's
  // live list. Fixes live-only models (e.g. OpenCode Zen free tier) vanishing
  // when the cache expires and falls back to the curated static list.
  const refreshModels = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)
    // Aino's account catalog is independent of the local/third-party runtime
    // catalog. Restore subscription rows even when that backend is slow or down.
    const platformRefresh = window.hermesDesktop?.platformModels ? platform.refresh() : Promise.resolve()

    try {
      const queryKey = modelOptionsQueryKey(profile, activeSessionId, ownerConnectionId)

      const next = await requestModelOptions({
        gateway,
        profile,
        refresh: true,
        request: requestGateway,
        sessionId: activeSessionId
      })

      // The refreshed catalog is a hint list, never a reason to move the pick:
      // a custom slug the row lacks is still what the user selected.
      queryClient.setQueryData<ModelOptionsResult>(queryKey, next)
    } catch {
      // Network/backend hiccup — fall back to a plain invalidate so the next
      // open re-fetches (still cached, but no worse than before).
      void queryClient.invalidateQueries({ queryKey: ['model-options'] })
    } finally {
      await platformRefresh
      setRefreshing(false)
    }
  }

  return (
    <ModelMenuPreviewContext.Provider value={presentation}>
      <div
        className="aino-model-menu-layout"
        data-detail-open={showDetail || undefined}
        onKeyDownCapture={event => {
          if (
            event.key === 'Escape' &&
            showDetail &&
            event.target instanceof HTMLElement &&
            !event.target.closest('[data-slot="dropdown-menu-sub-content"]')
          ) {
            event.preventDefault()
            event.stopPropagation()
            backToList()
          }
        }}
        ref={layoutRef}
      >
        <section className="aino-model-menu-list">
          <header className="aino-model-menu-heading">
            <strong>{previewCopy.title}</strong>
            <span>{previewCopy.currentChat}</span>
            <Button aria-label={t.common.close} onClick={closeMenu} size="icon-sm" variant="ghost">
              <Codicon name="close" />
            </Button>
          </header>
          {(blocked || builtinBlocked) && (
            <p className="aino-model-menu-busy" role="status">
              {t.platformModels.switchBusy}
            </p>
          )}
          <ModelCatalogMenu
            controller={controller}
            disabled={blocked}
            footer={
              <>
                {pinnedDraft && onFollowDefaultModel && (
                  <DropdownMenuItem onSelect={onFollowDefaultModel}>{copy.followDefault}</DropdownMenuItem>
                )}
                <DropdownMenuItem
                  aria-label={copy.refreshModels}
                  className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
                  disabled={refreshing}
                  onSelect={event => {
                    event.preventDefault()
                    void refreshModels()
                  }}
                >
                  <Codicon className={cn(refreshing && 'animate-spin')} name="sync" size="0.875rem" />
                  {previewCopy.refresh}
                </DropdownMenuItem>
              </>
            }
            gateway={gateway}
            header={<LocalSetupMenuRow />}
            includeMoa
            ownerConnectionId={ownerConnectionId}
            platformSection={
              window.hermesDesktop?.platformModels
                ? {
                    disabled: builtinBlocked || managedCapability !== 'supported',
                    models: platform.models,
                    props: {
                      disabled: builtinBlocked,
                      managedCapability,
                      onApplied: closeMenu,
                      onInspect: model => onInspect({ kind: 'aino', model }),
                      onPreview: model => onPreview({ kind: 'aino', model }),
                      onSelect: async model => {
                        const openInstance = readOpenInstance()
                        const result = await controller.select(model.id, 'aino')

                        return (
                          result !== false &&
                          openInstance === readOpenInstance() &&
                          controller.selectionIsCurrent?.() !== false
                        )
                      },
                      presentation: 'menu',
                      selectedId: currentProvider === 'aino' ? currentModel : undefined,
                      selectionIsCurrent: controller.selectionIsCurrent
                    }
                  }
                : undefined
            }
            profile={profile}
            request={requestGateway}
            sessionId={activeSessionId}
          />
          <p className="aino-model-menu-session-hint">{previewCopy.sessionHint}</p>
        </section>
        <ModelMenuPreviewDetails
          controller={controller}
          defaultEffort={defaultEffort}
          disabled={previewOptionsBlocked({
            preview: inspected,
            current: controller.current,
            activePlatformModel,
            builtinBlocked: builtinBlocked || managedCapability !== 'supported',
            customBlocked: blocked
          })}
          onBack={backToList}
          preview={inspected}
        />
      </div>
    </ModelMenuPreviewContext.Provider>
  )
}

function initialModelPreview(
  currentModel: string,
  currentProvider: string,
  models: readonly PlatformModel[],
  providers: readonly ModelOptionProvider[]
): ModelMenuPreview | null {
  const platform = models.find(model => model.id === currentModel)

  if (currentProvider === 'aino' && platform) {
    return { kind: 'aino', model: platform }
  }

  const provider = providers.find(candidate => catalogProviderMatches(candidate, currentProvider))

  if (provider && currentModel && currentProvider !== 'moa') {
    const family = collapseModelFamilies(provider.models ?? []).find(
      candidate => candidate.id === currentModel || candidate.fastId === currentModel
    ) ?? { id: currentModel, fastId: null }

    return { kind: 'custom', family, provider }
  }

  return models[0] ? { kind: 'aino', model: models[0] } : null
}

function latestModelPreview(
  entry: ModelMenuPreview | null,
  models: readonly PlatformModel[],
  providers: readonly ModelOptionProvider[]
): ModelMenuPreview | null {
  if (!entry) {
    return null
  }

  if (entry.kind === 'aino') {
    const model = models.find(candidate => candidate.id === entry.model.id)

    return model ? { kind: 'aino', model } : null
  }

  return { ...entry, provider: providers.find(candidate => candidate.slug === entry.provider.slug) ?? entry.provider }
}

interface PreviewOptionsPolicy {
  preview: ModelMenuPreview | null
  current: { model: string; provider: string }
  activePlatformModel: PlatformModel | null
  builtinBlocked: boolean
  customBlocked: boolean
}

function previewOptionsBlocked({
  preview,
  current,
  activePlatformModel,
  builtinBlocked,
  customBlocked
}: PreviewOptionsPolicy) {
  if (preview?.kind !== 'aino') {
    return customBlocked
  }

  const active = current.provider === 'aino' && current.model === preview.model.id

  return builtinBlocked || (active && activePlatformModel?.id !== preview.model.id)
}
