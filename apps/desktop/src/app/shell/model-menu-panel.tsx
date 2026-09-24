import type { ModelOptionsResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useQueryClient } from '@tanstack/react-query'
import { useContext, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { PlatformModelList } from '@/components/platform-model-list'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenuItem,
  dropdownMenuRow,
  DropdownMenuSub,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { modelOptionsQueryKey, requestModelOptions } from '@/lib/model-options'
import { managedModelSwitchBlocked } from '@/lib/model-switch-policy'
import { cn } from '@/lib/utils'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'

import { ModelCatalogMenu, ModelMenuCloseContext } from './model-catalog-menu'
import { ModelEditSubmenu } from './model-edit-submenu'
import { type ModelMenuHostProps, useModelMenuController } from './use-model-menu-controller'

export { ModelMenuCloseContext } from './model-catalog-menu'
export type { ModelSelection } from './use-model-menu-controller'

/**
 * The composer's model menu: `ModelCatalogMenu` (the shared renderer) plus the
 * controller that gives a selection its meaning HERE (`useModelMenuController`).
 */
export function ModelMenuPanel(props: ModelMenuHostProps) {
  const { gateway, onSelectModel, ownerConnectionId, profile = 'default', requestGateway } = props
  const { t } = useI18n()
  const copy = t.shell.modelMenu
  const [refreshing, setRefreshing] = useState(false)
  const queryClient = useQueryClient()
  const { activePlatformModel, activeSessionId, controller, defaultEffort } = useModelMenuController(props)
  const view = useSessionView()
  const currentModel = useStore(view.$model)
  const currentProvider = useStore(view.$provider)
  const currentReasoningEffort = useStore(view.$reasoningEffort)
  const busy = useStore(view.$busy)
  const awaiting = useStore(view.$awaitingResponse)
  const closeMenu = useContext(ModelMenuCloseContext)
  const managedCapabilities = useStore($gatewayManagedCapabilities)
  const managedCapability = managedModelRouteCapabilityFrom(managedCapabilities, {
    connectionId: ownerConnectionId,
    profile
  })
  const [source, setSource] = useState<'aino' | 'custom'>(() =>
    currentProvider && currentProvider !== 'aino' ? 'custom' : 'aino'
  )
  const blocked = managedModelSwitchBlocked(currentProvider, source === 'aino' ? 'aino' : '', busy || awaiting)

  // Explicit "Refresh Models": re-fetch the catalog with refresh:true so the
  // backend busts its 1h provider-model disk cache and re-pulls each provider's
  // live list. Fixes live-only models (e.g. OpenCode Zen free tier) vanishing
  // when the cache expires and falls back to the curated static list.
  const refreshModels = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)

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
      setRefreshing(false)
    }
  }

  return (
    <>
      {window.hermesDesktop?.platformModels && (
        <div className="p-2">
          <SegmentedControl
            onChange={setSource}
            options={[
              { id: 'aino', label: t.platformModels.builtIn },
              { id: 'custom', label: t.platformModels.custom }
            ]}
            value={source}
          />
        </div>
      )}
      {blocked && (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          {t.platformModels.switchBusy}
        </p>
      )}
      {source === 'aino' && window.hermesDesktop?.platformModels ? (
        <>
          <PlatformModelList
            disabled={blocked}
            managedCapability={managedCapability}
            onApplied={closeMenu}
            onChooseCustom={() => setSource('custom')}
            onSelect={model => onSelectModel({ provider: 'aino', model: model.id, sessionId: activeSessionId })}
            selectedId={currentProvider === 'aino' ? currentModel : undefined}
          />
          {activePlatformModel?.capabilities.reasoning && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={dropdownMenuRow}>{t.platformModels.reasoning}</DropdownMenuSubTrigger>
              <ModelEditSubmenu
                defaultEffort={defaultEffort}
                effort={currentReasoningEffort}
                fastControl={{ kind: 'none' }}
                isActive
                model={activePlatformModel.id}
                onSelectModel={() => undefined}
                onSetOptions={patch => {
                  if (patch.effort !== undefined) {
                    controller.setOptions(patch, { isActive: true, model: activePlatformModel.id, provider: 'aino' })
                  }
                }}
                provider="aino"
                reasoning
              />
            </DropdownMenuSub>
          )}
        </>
      ) : (
        <ModelCatalogMenu
          controller={controller}
          disabled={blocked}
          footer={
            <DropdownMenuItem
              className={cn(dropdownMenuRow, 'text-(--ui-text-tertiary)')}
              disabled={refreshing}
              onSelect={event => {
                event.preventDefault()
                void refreshModels()
              }}
            >
              <Codicon className={cn(refreshing && 'animate-spin')} name="sync" size="0.75rem" />
              {copy.refreshModels}
            </DropdownMenuItem>
          }
          gateway={gateway}
          includeMoa
          ownerConnectionId={ownerConnectionId}
          profile={profile}
          request={requestGateway}
          sessionId={activeSessionId}
        />
      )}
    </>
  )
}
