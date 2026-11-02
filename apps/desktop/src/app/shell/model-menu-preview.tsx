import { isReasoningEffort, type ModelOptionProvider } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { createContext, type ReactNode, type RefObject, useRef, useState } from 'react'

import { PlatformModelDetails } from '@/components/platform-model-details'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { modelMenuPreviewCopy } from '@/i18n/model-menu-preview'
import { catalogProviderMatches } from '@/lib/model-options'
import { displayModelName } from '@/lib/model-status-label'
import { reasoningEffortLabel } from '@/lib/reasoning-effort'
import { $favoriteModels, favoriteModelKey, toggleFavoriteModel } from '@/store/favorite-models'
import type { ModelFamily } from '@/store/model-visibility'

import type { PlatformModel } from '../../../shared/platform-contract'

import type { ModelMenuController } from './model-catalog-menu'
import { ModelOptionsContent, resolveFastControl } from './model-edit-submenu'

export type ModelMenuPreview =
  { kind: 'custom'; family: ModelFamily; provider: ModelOptionProvider } | { kind: 'aino'; model: PlatformModel }

export const ModelMenuPreviewContext = createContext<{
  onPreview: (preview: ModelMenuPreview) => void
  onInspect: (preview: ModelMenuPreview) => void
} | null>(null)

interface ModelMenuPreviewDetailsProps {
  preview: ModelMenuPreview | null
  controller: ModelMenuController
  defaultEffort: string
  onBack: () => void
  disabled?: boolean
}

function previewIdentity(preview: ModelMenuPreview, current: ModelMenuController['current']) {
  if (preview.kind === 'aino') {
    return {
      model: preview.model.id,
      provider: 'aino',
      title: preview.model.display_name,
      active: current.provider === 'aino' && current.model === preview.model.id
    }
  }

  return {
    model: preview.family.id,
    provider: preview.provider.slug,
    title: displayModelName(preview.family.id),
    active:
      catalogProviderMatches(preview.provider, current.provider) &&
      (current.model === preview.family.id || current.model === preview.family.fastId)
  }
}

function previewOptions(
  preview: ModelMenuPreview,
  controller: ModelMenuController,
  identity: ReturnType<typeof previewIdentity>
) {
  const { model, provider, active } = identity
  const current = controller.current
  const preset = controller.presetFor(provider, model)
  const effort = active ? current.effort : (preset.effort ?? '')
  const fast = active ? current.fast : (preset.fast ?? false)
  const serviceTier = active ? current.serviceTier : preset.serviceTier

  const caps = preview.kind === 'aino' ? null : preview.provider.capabilities?.[model]

  const reasoning = preview.kind === 'aino' ? preview.model.capabilities.reasoning : (caps?.reasoning ?? true)

  const fastControl =
    preview.kind === 'aino' || controller.allowSpeed === false
      ? { kind: 'none' as const }
      : resolveFastControl(active ? current.model : model, preview.provider.models ?? [], caps?.fast ?? false, fast)

  const ultrafast = previewUltrafast(preview, controller)

  return { effort, serviceTier, caps, reasoning, fastControl, ultrafast }
}

function previewUltrafast(preview: ModelMenuPreview, controller: ModelMenuController): boolean {
  return (
    preview.kind !== 'aino' &&
    controller.allowSpeed !== false &&
    (preview.provider.capabilities?.[preview.family.id]?.ultrafast ?? false)
  )
}

interface PreviewContentProps {
  preview: ModelMenuPreview
  identity: ReturnType<typeof previewIdentity>
}

function ModelPreviewHeader({
  preview,
  identity,
  favoriteKeys,
  onBack
}: PreviewContentProps & {
  favoriteKeys: string[]
  onBack: () => void
}) {
  const { locale, t } = useI18n()
  const copy = modelMenuPreviewCopy(locale)
  const { model, provider, title, active } = identity
  const builtin = preview.kind === 'aino'
  const favorite = favoriteKeys.includes(favoriteModelKey(provider, model))

  return (
    <>
      <div className="aino-model-menu-mobile-back">
        <Button aria-label={copy.back} onClick={onBack} size="xs" variant="ghost">
          <Codicon name="arrow-left" />
          {copy.back}
        </Button>
      </div>
      <div className="aino-model-menu-detail-head">
        <Codicon name={builtin ? 'brain' : 'database'} size="1rem" />
        <strong>{title}</strong>
        {!builtin && (
          <Button
            aria-label={favorite ? t.shell.modelMenu.removeFavorite : t.shell.modelMenu.addFavorite}
            aria-pressed={favorite}
            onClick={event => {
              event.stopPropagation()
              toggleFavoriteModel(provider, model)
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Codicon name={favorite ? 'star-full' : 'star-empty'} size="0.875rem" />
          </Button>
        )}
      </div>
      <div className="aino-model-menu-detail-source">
        <span>{builtin ? t.platformModels.builtIn : preview.provider.name}</span>
        <span className={active ? 'aino-model-menu-current-badge' : undefined}>
          {active ? copy.currentUse : copy.previewOnly}
        </span>
      </div>
      <p className="aino-model-menu-detail-description">{builtin ? copy.builtinDescription : copy.customDescription}</p>
    </>
  )
}

function ModelPreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="aino-model-menu-detail-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  )
}

function ModelPreviewFacts({
  preview,
  options
}: {
  preview: ModelMenuPreview
  options: ReturnType<typeof previewOptions>
}) {
  const { locale, t } = useI18n()
  const copy = modelMenuPreviewCopy(locale)
  const { caps, reasoning } = options
  const builtin = preview.kind === 'aino'

  const billing = builtin
    ? preview.model.billing_source === 'subscription'
      ? t.platformModels.subscription
      : t.platformModels.balance
    : copy.providerAccount

  return (
    <>
      <ModelPreviewRow label={copy.billing}>{billing}</ModelPreviewRow>
      {(builtin || caps) && (
        <ModelPreviewRow label={copy.mode}>{reasoning ? copy.deepThinking : copy.standard}</ModelPreviewRow>
      )}
      {builtin && !!preview.model.context_window && (
        <ModelPreviewRow label={t.platformModels.context}>
          {preview.model.context_window.toLocaleString()}
        </ModelPreviewRow>
      )}
      <ModelPreviewPrices preview={preview} />
    </>
  )
}

function ModelPreviewPrices({ preview }: { preview: ModelMenuPreview }) {
  const { locale, t } = useI18n()
  const copy = modelMenuPreviewCopy(locale)

  if (preview.kind === 'aino') {
    return null
  }

  const pricing =
    preview.provider.pricing?.[preview.family.id] ??
    (preview.family.fastId ? preview.provider.pricing?.[preview.family.fastId] : null)

  if (pricing?.free) {
    return <ModelPreviewRow label={copy.billing}>{t.shell.modelMenu.free}</ModelPreviewRow>
  }

  const fields: Array<[string, string | null | undefined]> = [
    [t.platformModels.input, pricing?.input],
    [t.platformModels.output, pricing?.output],
    [t.platformModels.cacheRead, pricing?.cache]
  ]

  return (
    <>
      {fields.map(
        ([label, value]) =>
          value && (
            <ModelPreviewRow key={label} label={label}>
              {value}/Mtok
            </ModelPreviewRow>
          )
      )}
    </>
  )
}

interface PreviewOptionsProps extends PreviewContentProps {
  controller: ModelMenuController
  defaultEffort: string
  disabled?: boolean
  options: ReturnType<typeof previewOptions>
  optionsOwner: string | null
  setOptionsOwner: (owner: string | null) => void
  optionsTrigger: RefObject<HTMLDivElement | null>
}

function ModelPreviewOptions({
  identity,
  controller,
  defaultEffort,
  disabled,
  options,
  optionsOwner,
  setOptionsOwner,
  optionsTrigger
}: PreviewOptionsProps) {
  const { t } = useI18n()
  const { model, provider, active } = identity
  const { effort, caps, reasoning, fastControl, ultrafast, serviceTier } = options
  const current = controller.current
  const optionsKey = provider + ':' + model

  const localizedEffort = reasoningEffortLabel(
    effort || defaultEffort,
    active ? current.effortWire : undefined,
    level => (isReasoningEffort(level) ? t.shell.modelOptions[level] : level === 'none' ? t.common.off : level)
  )

  return (
    <DropdownMenuSub
      key={optionsKey}
      onOpenChange={open => setOptionsOwner(open ? optionsKey : null)}
      open={optionsOwner === optionsKey}
    >
      <DropdownMenuSubTrigger className="aino-model-menu-detail-row" disabled={disabled} ref={optionsTrigger}>
        <span>{reasoning ? t.shell.modelOptions.effort : t.shell.modelOptions.options}</span>
        <span>{reasoning ? localizedEffort : ''}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-52 p-0"
        onEscapeKeyDown={event => {
          event.preventDefault()
          setOptionsOwner(null)
          optionsTrigger.current?.focus()
        }}
        sideOffset={4}
      >
        <ModelOptionsContent
          canDisableReasoning={caps?.can_disable_reasoning ?? undefined}
          defaultEffort={defaultEffort}
          effort={effort}
          effortWire={active ? current.effortWire : undefined}
          fastControl={fastControl}
          isActive={active}
          model={model}
          onSelectModel={nextModel => (disabled ? undefined : controller.select(nextModel, provider))}
          onSetOptions={patch => {
            if (!disabled) {
              controller.setOptions(patch, { isActive: active, model, provider })
            }
          }}
          provider={provider}
          reasoning={reasoning}
          serviceTier={serviceTier}
          ultrafastSupported={ultrafast}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** The same catalog choice inspected without invoking its selection handler. */
export function ModelMenuPreviewDetails({
  preview,
  controller,
  defaultEffort,
  onBack,
  disabled
}: ModelMenuPreviewDetailsProps) {
  const { locale } = useI18n()
  const copy = modelMenuPreviewCopy(locale)
  const favoriteKeys = useStore($favoriteModels)
  const [optionsOwner, setOptionsOwner] = useState<string | null>(null)
  const optionsTrigger = useRef<HTMLDivElement>(null)

  if (!preview) {
    return (
      <aside aria-label={copy.details} className="aino-model-menu-detail" tabIndex={-1}>
        <p className="aino-model-menu-detail-hint">{copy.previewHint}</p>
      </aside>
    )
  }

  const identity = previewIdentity(preview, controller.current)
  const options = previewOptions(preview, controller, identity)
  const hasOptions = options.reasoning || options.fastControl.kind !== 'none' || options.ultrafast

  return (
    <aside aria-label={copy.details} className="aino-model-menu-detail" tabIndex={-1}>
      <ModelPreviewHeader favoriteKeys={favoriteKeys} identity={identity} onBack={onBack} preview={preview} />
      <div className="aino-model-menu-detail-rows">
        <ModelPreviewFacts options={options} preview={preview} />
        {hasOptions && (
          <ModelPreviewOptions
            controller={controller}
            defaultEffort={defaultEffort}
            disabled={disabled}
            identity={identity}
            options={options}
            optionsOwner={optionsOwner}
            optionsTrigger={optionsTrigger}
            preview={preview}
            setOptionsOwner={setOptionsOwner}
          />
        )}
      </div>
      {preview.kind === 'aino' && (
        <details className="aino-model-menu-detail-pricing">
          <summary>{copy.pricingAndCapabilities}</summary>
          <PlatformModelDetails model={preview.model} />
        </details>
      )}
      <p className="aino-model-menu-detail-hint">{identity.active ? copy.currentHint : copy.previewHint}</p>
    </aside>
  )
}
