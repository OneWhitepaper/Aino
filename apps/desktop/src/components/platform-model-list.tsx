import { modelSearchText } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router'

import { SETTINGS_ROUTE } from '@/app/routes'
import { useI18n } from '@/i18n'
import { Check } from '@/lib/icons'
import { platformModelSupportsPurpose } from '@/lib/platform-model-purpose'
import { foldIncludes } from '@/lib/text'
import type { ManagedModelRouteCapability } from '@/store/gateway-managed-capability'
import { notifyError } from '@/store/notifications'
import { platformModelCatalog } from '@/store/platform-models'

import { hasPlatformModelIdentity, type PlatformModel, type PlatformModelPurpose } from '../../shared/platform-contract'

import { PlatformModelDetails } from './platform-model-details'
import { PlatformModelRate } from './platform-model-rate'
import { Button } from './ui/button'
import { Codicon } from './ui/codicon'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from './ui/dropdown-menu'

export function usePlatformModels(purpose: PlatformModelPurpose = 'chat') {
  const catalog = platformModelCatalog()
  const state = useStore(catalog.state)
  const account = useStore(catalog.account)
  const identityReady = hasPlatformModelIdentity(account)
  useEffect(() => {
    // Reopening checks the existing TTL without clearing a fresh catalog.
    // Account-specific rates may have changed since this picker was last used.
    void catalog.load()
  }, [catalog, account?.revision, account?.mode, account?.account?.id, identityReady])

  return {
    ...state,
    models: state.models.filter(model => platformModelSupportsPurpose(model, purpose)),
    account,
    refresh: catalog.refresh
  }
}

export interface PlatformModelListProps {
  activeId?: string
  selectedId?: string
  disabled?: boolean
  onChooseCustom?: () => void
  onSelect: (model: PlatformModel) => Promise<boolean> | boolean | void
  onApplied?: () => void
  managedCapability: ManagedModelRouteCapability
  purpose?: PlatformModelPurpose
  fitContent?: boolean
  presentation?: 'picker' | 'menu'
  /** A composer menu shares one search field with the custom catalog. */
  searchValue?: string
  onPreview?: (model: PlatformModel) => void
  onInspect?: (model: PlatformModel) => void
  selectionIsCurrent?: () => boolean
}

function AccountAction({ label }: { label: string }) {
  const navigate = useNavigate()

  return (
    <Button data-action="account" onClick={() => navigate(`${SETTINGS_ROUTE}?tab=account`)} size="sm" variant="ghost">
      {label}
    </Button>
  )
}

interface PlatformModelMenuRowsProps extends Pick<
  PlatformModelListProps,
  'selectedId' | 'activeId' | 'disabled' | 'onPreview' | 'onInspect'
> {
  models: PlatformModel[]
  onSelect: (model: PlatformModel) => Promise<void>
  status: ReactNode
}

function PlatformModelMenuRows({
  activeId,
  models,
  selectedId,
  disabled,
  onPreview,
  onInspect,
  onSelect: select,
  status
}: PlatformModelMenuRowsProps) {
  const { t } = useI18n()
  const copy = t.platformModels

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="aino-model-menu-group-label">{copy.builtIn}</DropdownMenuLabel>
      {status ??
        (models.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{copy.empty}</p>
        ) : (
          models.map(model => (
            <DropdownMenuItem
              aria-current={selectedId === model.id ? 'true' : undefined}
              className="aino-model-menu-row"
              data-kb-active={activeId === model.id ? '' : undefined}
              data-platform-model-id={model.id}
              data-selected={selectedId === model.id ? '' : undefined}
              disabled={disabled || model.state !== 'available'}
              key={model.id}
              onFocus={() => onPreview?.(model)}
              onPointerMove={() => onPreview?.(model)}
              onSelect={event => {
                event.preventDefault()
                void select(model)
              }}
              textValue={model.display_name}
            >
              <Codicon name="brain" size="1rem" />
              <span className="aino-model-menu-name">{model.display_name}</span>
              <PlatformModelRate model={model} />
              {model.state !== 'available' && (
                <span className="text-xs text-muted-foreground">{copy[model.state]}</span>
              )}
              {selectedId === model.id && <Codicon className="aino-model-menu-check" name="check" size="0.875rem" />}
              {(onInspect || onPreview) && (
                <button
                  aria-label={`${copy.details}: ${model.display_name}`}
                  className="aino-model-menu-details-button"
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    const inspect = onInspect ?? onPreview
                    inspect?.(model)
                  }}
                  onKeyDown={event => event.stopPropagation()}
                  tabIndex={-1}
                  type="button"
                >
                  <Codicon name="chevron-right" size="0.75rem" />
                </button>
              )}
            </DropdownMenuItem>
          ))
        ))}
    </DropdownMenuGroup>
  )
}

function platformModelStatus(
  phase: ReturnType<typeof usePlatformModels>['phase'],
  hasModels: boolean,
  managedCapability: ManagedModelRouteCapability,
  copy: ReturnType<typeof useI18n>['t']['platformModels']
) {
  return managedCapability !== 'supported' ? (
    <p className="p-3 text-xs text-muted-foreground" role="status">
      {copy.unsupported}
    </p>
  ) : phase === 'signed_out' ? (
    <p className="p-3 text-xs text-muted-foreground">{copy.not_authenticated}</p>
  ) : phase === 'loading' && !hasModels ? (
    <p className="p-3 text-xs text-muted-foreground" role="status">
      {copy.loading}
    </p>
  ) : phase === 'error' ? (
    <p className="p-3 text-xs text-muted-foreground" role="alert">
      {copy.catalogError}
    </p>
  ) : null
}

interface PlatformModelRecoveryProps {
  catalog: ReturnType<typeof usePlatformModels>
  models: PlatformModel[]
  managedCapability: ManagedModelRouteCapability
  chooseCustom: ReactNode
}

function PlatformModelRecovery({ catalog, models, managedCapability, chooseCustom }: PlatformModelRecoveryProps) {
  const { t } = useI18n()
  const copy = t.platformModels
  const inRouter = useInRouterContext()
  const unavailableModels = models.filter(model => model.state !== 'available')

  return managedCapability !== 'supported' ? (
    chooseCustom && <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2">{chooseCustom}</div>
  ) : catalog.phase === 'signed_out' ? (
    inRouter && (
      <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2">
        <AccountAction label={copy.myAccount} />
      </div>
    )
  ) : catalog.phase === 'error' ? (
    <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2">
      <Button onClick={() => void catalog.refresh()} size="sm" variant="ghost">
        {copy.retry}
      </Button>
    </div>
  ) : catalog.phase === 'ready' && catalog.models.length === 0 ? (
    chooseCustom && <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2">{chooseCustom}</div>
  ) : unavailableModels.length > 0 ? (
    <div className="space-y-1 border-t border-(--ui-stroke-tertiary) px-3 py-2">
      {unavailableModels.map(model => (
        <div
          aria-label={copy.recoveryFor(model.display_name)}
          className="flex flex-wrap items-center gap-1"
          key={model.id}
          role="group"
        >
          <span className="mr-auto truncate text-xs text-muted-foreground">{model.display_name}</span>
          {['insufficient_balance', 'quota_exhausted'].includes(model.state) && inRouter && (
            <AccountAction label={copy.myAccount} />
          )}
          {chooseCustom}
        </div>
      ))}
    </div>
  ) : null
}

export function PlatformModelList({
  activeId,
  selectedId,
  disabled,
  onChooseCustom,
  onSelect,
  onApplied,
  managedCapability,
  purpose = 'chat',
  fitContent = false,
  presentation = 'picker',
  searchValue,
  onPreview,
  onInspect,
  selectionIsCurrent
}: PlatformModelListProps) {
  const { t } = useI18n()
  const copy = t.platformModels
  const catalog = usePlatformModels(purpose)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(selectedId || '')
  const [pending, setPending] = useState(false)
  const selecting = useRef(false)
  const mounted = useRef(true)
  useLayoutEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
    }
  }, [])

  const models = catalog.models.filter(model =>
    foldIncludes(
      modelSearchText(`${model.display_name} ${model.model} ${model.provider_label}`),
      modelSearchText(searchValue ?? search)
    )
  )

  const detail =
    catalog.models.find(model => model.id === highlighted) ?? catalog.models.find(model => model.id === selectedId)

  const chooseCustom = onChooseCustom ? (
    <Button data-action="custom" onClick={onChooseCustom} size="sm" variant="ghost">
      {copy.chooseCustom}
    </Button>
  ) : null

  const select = async (model: PlatformModel) => {
    if (disabled || managedCapability !== 'supported' || selecting.current || model.state !== 'available') {
      return
    }

    selecting.current = true
    setPending(true)

    try {
      if ((await onSelect(model)) !== false && mounted.current && selectionIsCurrent?.() !== false) {
        onApplied?.()
      }
    } catch (error) {
      notifyError(error, copy.bindingFailed)
    } finally {
      selecting.current = false

      if (mounted.current) {
        setPending(false)
      }
    }
  }

  const status = platformModelStatus(catalog.phase, models.length > 0, managedCapability, copy)

  return (
    <div className={presentation === 'menu' ? 'aino-platform-menu-models min-w-0' : 'min-w-0'}>
      {presentation === 'menu' ? (
        <PlatformModelMenuRows
          activeId={activeId}
          disabled={disabled || pending}
          models={models}
          onInspect={onInspect}
          onPreview={onPreview}
          onSelect={select}
          selectedId={selectedId}
          status={status}
        />
      ) : (
        <Command
          className={fitContent ? 'h-auto' : undefined}
          onKeyDown={event => event.stopPropagation()}
          onValueChange={setHighlighted}
          shouldFilter={false}
          value={highlighted}
        >
          <CommandInput aria-label={copy.search} onValueChange={setSearch} placeholder={copy.search} value={search} />
          <CommandList aria-label={copy.builtIn} className="max-h-64">
            {status ?? (
              <>
                <CommandEmpty>{copy.empty}</CommandEmpty>
                <CommandGroup>
                  {models.map(model => (
                    <CommandItem
                      disabled={disabled || pending || managedCapability !== 'supported' || model.state !== 'available'}
                      key={model.id}
                      onSelect={() => void select(model)}
                      value={model.id}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{model.display_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {model.state === 'available'
                            ? model.billing_source === 'subscription'
                              ? copy.subscription
                              : copy.balance
                            : model.state === 'unavailable'
                              ? copy.unavailable
                              : copy[model.state]}
                        </span>
                      </span>
                      <PlatformModelRate model={model} />
                      {selectedId === model.id && <Check className="size-3.5 shrink-0" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      )}
      <PlatformModelRecovery
        catalog={catalog}
        chooseCustom={chooseCustom}
        managedCapability={managedCapability}
        models={models}
      />
      {presentation !== 'menu' && detail && (
        <details className="border-t border-(--ui-stroke-tertiary) px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">{copy.details}</summary>
          <PlatformModelDetails model={detail} />
        </details>
      )}
    </div>
  )
}
