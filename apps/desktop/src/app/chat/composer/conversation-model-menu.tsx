import type { ModelOptionsResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { ModelCatalogMenu, type ModelMenuController } from '@/app/shell/model-catalog-menu'
import { ModelMenuCloseContext } from '@/app/shell/model-menu-panel'
import { PlatformModelList } from '@/components/platform-model-list'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'
import { requestGatewayForAgent } from '@/store/gateway'
import type { ConversationOwner } from '@/store/conversation-owner'

import type { ConversationModelSelection } from '../conversation-configuration-actions'
import { ModelPillButton } from './model-pill'

interface ConversationModelMenuProps {
  owner: ConversationOwner
  participantId: string
  profile: string
  generation: number
  model?: { model?: string | null; provider?: string | null; model_source?: string | null; model_id?: string | null }
  disabled: boolean
  onRefresh: (participantId: string, generation: number, selection?: ConversationModelSelection) => Promise<unknown>
}
export function ConversationModelMenu({
  owner,
  participantId,
  profile,
  generation,
  model,
  disabled,
  onRefresh
}: ConversationModelMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelOptionsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'aino' | 'custom'>(model?.model_source === 'aino' ? 'aino' : 'custom')
  const [selection, setSelection] = useState<ConversationModelSelection | null>(null)
  useEffect(() => {
    if (model?.model_source) setSource(model.model_source === 'aino' ? 'aino' : 'custom')
  }, [model?.model_source])
  const capabilities = useStore($gatewayManagedCapabilities)
  const request = useCallback(
    <T,>(method: string, params?: Record<string, unknown>) =>
      requestGatewayForAgent<T>(owner.connectionId, 'default', method, { ...params, profile }),
    [owner.connectionId, profile]
  )
  useEffect(() => {
    let disposed = false
    void request<ModelOptionsResult>('model.options', {})
      .then(result => {
        if (!disposed) setCatalog(result)
      })
      .catch(reason => {
        if (!disposed) setError(String(reason))
      })
    return () => {
      disposed = true
    }
  }, [request])
  const current = {
    model: model?.model || catalog?.model || '',
    provider: model?.provider || catalog?.provider || '',
    fast: false,
    effort: ''
  }
  const controller: ModelMenuController = {
    current,
    select: (model, provider) => {
      setOpen(false)
      setSelection({ model_source: provider === 'aino' ? 'aino' : 'byok', model_id: model })
    },
    applyPreset: () => {},
    presetFor: () => ({}),
    setOptions: () => {
      setError(t.composer.conversation.refreshExplanation)
    }
  }
  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <ModelPillButton disabled={disabled} aria-label={t.shell.statusbar.openModelPicker}>
            <span className="truncate">{current.model || t.composer.conversation.modelUnavailable}</span>
            <ChevronDown className="size-2.5 shrink-0 opacity-50" />
          </ModelPillButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-64 p-0"
          onCloseAutoFocus={event => {
            if (selection) event.preventDefault()
          }}
        >
          <ModelMenuCloseContext.Provider value={() => setOpen(false)}>
            {window.hermesDesktop?.platformModels && (
              <div className="p-2">
                <SegmentedControl
                  value={source}
                  onChange={setSource}
                  options={[
                    { id: 'aino', label: t.platformModels.builtIn },
                    { id: 'custom', label: t.platformModels.custom }
                  ]}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="p-3 text-xs">
                {error}
              </p>
            )}
            {source === 'aino' && window.hermesDesktop?.platformModels ? (
              <PlatformModelList
                disabled={disabled}
                selectedId={model?.model_source === 'aino' ? (model.model_id ?? undefined) : undefined}
                managedCapability={managedModelRouteCapabilityFrom(capabilities, {
                  connectionId: owner.connectionId,
                  profile
                })}
                onChooseCustom={() => setSource('custom')}
                onSelect={model => {
                  setOpen(false)
                  setSelection({ model_source: 'aino', model_id: model.id })
                }}
              />
            ) : (
              <ModelCatalogMenu
                optionsEditable={false}
                providerFilter={catalog?.provider || '__unresolved_profile_provider__'}
                controller={controller}
                disabled={disabled}
                ownerConnectionId={owner.connectionId}
                profile={profile}
                request={request}
              />
            )}
          </ModelMenuCloseContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={Boolean(selection)}
        onClose={() => setSelection(null)}
        title={selection?.model_id}
        description={t.composer.conversation.refreshExplanation}
        onConfirm={async () => {
          if (selection) await onRefresh(participantId, generation, selection)
        }}
      />
    </>
  )
}
