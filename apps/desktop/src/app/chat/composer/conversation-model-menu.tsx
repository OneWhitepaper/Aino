import type { ModelOptionsResult } from '@hermes/shared'
import type { ConversationModelSnapshot } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { ModelCatalogMenu, type ModelMenuController } from '@/app/shell/model-catalog-menu'
import { ModelOptionsContent } from '@/app/shell/model-edit-submenu'
import { ModelMenuCloseContext } from '@/app/shell/model-menu-panel'
import { PlatformModelList } from '@/components/platform-model-list'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'
import { requestGatewayForAgent } from '@/store/gateway'
import { $gatewayManagedCapabilities, managedModelRouteCapabilityFrom } from '@/store/gateway-managed-capability'

import type { ConversationModelSelection } from '../conversation-configuration-actions'

import { ModelPillButton } from './model-pill'
import { ReasoningPillSurface } from './reasoning-pill'

interface PendingModelSelection extends ConversationModelSelection {
  ownerKey: string
  participantId: string
  generation: number
}

interface ConversationModelMenuProps {
  owner: ConversationOwner
  participantId: string
  profile: string
  generation: number
  model?: Partial<ConversationModelSnapshot>
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
  const [selection, setSelection] = useState<PendingModelSelection | null>(null)
  useEffect(() => {
    if (model?.model_source) {
      setSource(model.model_source === 'aino' ? 'aino' : 'custom')
    }
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
        if (!disposed) {
          setCatalog(result)
        }
      })
      .catch(reason => {
        if (!disposed) {
          setError(String(reason))
        }
      })

    return () => {
      disposed = true
    }
  }, [request])

  const current = {
    model: model?.model || catalog?.model || '',
    provider: model?.provider || catalog?.provider || '',
    fast: model?.fast ?? false,
    effort: model?.reasoning_effort ?? ''
  }

  const choose = (choice: ConversationModelSelection) =>
    setSelection({ ...choice, ownerKey: conversationOwnerKey(owner), participantId, generation })

  const controller: ModelMenuController = {
    current,
    select: (model, provider) => {
      setOpen(false)
      choose({ model_source: provider === 'aino' ? 'aino' : 'byok', model_id: model })
    },
    applyPreset: () => {},
    presetFor: () => ({}),
    setOptions: () => {
      setError(t.composer.conversation.refreshExplanation)
    }
  }

  return (
    <>
      <DropdownMenu onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>
          <ModelPillButton aria-label={t.shell.statusbar.openModelPicker} disabled={disabled}>
            <span className="truncate">{current.model || t.composer.conversation.modelUnavailable}</span>
            <ChevronDown className="size-2.5 shrink-0 opacity-50" />
          </ModelPillButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 p-0"
          onCloseAutoFocus={event => {
            if (selection) {
              event.preventDefault()
            }
          }}
          side="top"
        >
          <ModelMenuCloseContext.Provider value={() => setOpen(false)}>
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
            {error && (
              <p className="p-3 text-xs" role="alert">
                {error}
              </p>
            )}
            {source === 'aino' && window.hermesDesktop?.platformModels ? (
              <PlatformModelList
                disabled={disabled}
                managedCapability={managedModelRouteCapabilityFrom(capabilities, {
                  connectionId: owner.connectionId,
                  profile
                })}
                onChooseCustom={() => setSource('custom')}
                onSelect={model => {
                  setOpen(false)
                  choose({ model_source: 'aino', model_id: model.id })
                }}
                selectedId={model?.model_source === 'aino' ? (model.model_id ?? undefined) : undefined}
              />
            ) : (
              <ModelCatalogMenu
                controller={controller}
                disabled={disabled}
                optionsEditable={false}
                ownerConnectionId={owner.connectionId}
                profile={profile}
                providerFilter={catalog?.provider || '__unresolved_profile_provider__'}
                request={request}
              />
            )}
          </ModelMenuCloseContext.Provider>
        </DropdownMenuContent>
      </DropdownMenu>
      {model?.capabilities && (model.capabilities?.reasoning === true || model.capabilities?.fast === true) && (
        <ReasoningPillSurface disabled={disabled} effort={current.effort}>
          <ModelMenuCloseContext.Consumer>
            {close => (
              <ModelOptionsContent
                canDisableReasoning={model.capabilities?.can_disable_reasoning === true}
                defaultEffort={current.effort}
                effort={current.effort}
                effortKnown={model.reasoning_effort != null}
                fastControl={model.capabilities?.fast === true ? { kind: 'param', on: current.fast } : { kind: 'none' }}
                isActive
                model={current.model}
                onSelectModel={() => {}}
                onSetOptions={patch => {
                  close()
                  choose({
                    model_source: model.model_source === 'aino' ? 'aino' : 'byok',
                    model_id: model.model_id || model.model || undefined,
                    ...(patch.effort === undefined ? {} : { reasoning_effort: patch.effort }),
                    ...(patch.fast === undefined ? {} : { fast: patch.fast })
                  })
                }}
                provider={current.provider}
                reasoning={model.capabilities?.reasoning === true}
              />
            )}
          </ModelMenuCloseContext.Consumer>
        </ReasoningPillSurface>
      )}
      <ConfirmDialog
        description={t.composer.conversation.refreshExplanation}
        onClose={() => setSelection(null)}
        onConfirm={async () => {
          if (!selection) {
            return
          }
          const { ownerKey, participantId: selectedParticipant, generation: selectedGeneration, ...choice } = selection

          if (ownerKey !== conversationOwnerKey(owner) || selectedParticipant !== participantId) {
            throw new Error(t.composer.conversation.runtimeChanged)
          }

          await onRefresh(selectedParticipant, selectedGeneration, choice)
        }}
        open={Boolean(selection)}
        title={selection?.model_id}
      />
    </>
  )
}
