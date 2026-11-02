import type { ModelOptionProvider } from '@hermes/shared'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { MoaConfigResponse } from '@/hermes'
import { useI18n } from '@/i18n'
import { findCatalogProvider } from '@/lib/model-options'
import { cn } from '@/lib/utils'

import { CONTROL_TEXT } from './constants'
import { ModelSelect, withActive } from './model-select'
import type { useMoaEditing } from './use-moa-editing'

interface MoaModelSlotsProps {
  applying: boolean
  currentMoaPreset: MoaConfigResponse['presets'][string]
  modelsForProvider: (provider: string) => string[]
  moaSlotProviderOptions: readonly ModelOptionProvider[]
  providers: readonly ModelOptionProvider[]
  selectedMoaPreset: string
  updateMoaPreset: ReturnType<typeof useMoaEditing>['updateMoaPreset']
  updateMoaSlot: ReturnType<typeof useMoaEditing>['updateMoaSlot']
}

export function MoaModelSlots({
  applying,
  currentMoaPreset,
  modelsForProvider,
  moaSlotProviderOptions,
  providers,
  selectedMoaPreset,
  updateMoaPreset,
  updateMoaSlot
}: MoaModelSlotsProps) {
  const { t } = useI18n()
  const m = t.settings.model

  return (
    <>
      <section className="model-settings-moa-section">
        <div className="model-settings-subpage-heading">
          <div>
            <h3>{m.pages.moaReferences}</h3>
            <p>{m.moaReferenceHint}</p>
          </div>
          <Button
            disabled={applying}
            onClick={() =>
              updateMoaPreset(prev => ({
                ...prev,
                reference_models: [...prev.reference_models, { ...prev.aggregator, enabled: true }]
              }))
            }
            size="sm"
            variant="textStrong"
          >
            {m.moaAddReference}
          </Button>
        </div>
        <div aria-hidden="true" className="model-settings-moa-slot-heading">
          <span />
          <span>{m.provider}</span>
          <span>{m.model}</span>
          <span />
        </div>
        {currentMoaPreset.reference_models.map((slot, index) => (
          <div
            className={cn('model-settings-moa-slot', slot.enabled === false && 'opacity-60')}
            key={`${selectedMoaPreset}-${index}`}
          >
            <span className="model-settings-moa-slot-label">{m.moaReferenceTitle(index + 1)}</span>

            <Select
              onValueChange={value =>
                updateMoaPreset(prev => ({
                  ...prev,
                  reference_models: prev.reference_models.map((s, i) =>
                    i === index ? updateMoaSlot(s, { provider: value }) : s
                  )
                }))
              }
              value={slot.provider}
            >
              <SelectTrigger
                aria-label={`${m.moaReferenceTitle(index + 1)} ${m.provider}`}
                className={cn('w-full min-w-0', CONTROL_TEXT)}
              >
                <SelectValue placeholder={m.provider} />
              </SelectTrigger>
              <SelectContent>
                {withActive(
                  moaSlotProviderOptions.map(p => p.slug || 'none'),
                  slot.provider
                ).map(slug => {
                  const provider = moaSlotProviderOptions.find(p => (p.slug || 'none') === slug)

                  return (
                    <SelectItem key={slug} value={slug}>
                      {provider?.name || slug}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <ModelSelect
              aria-label={`${m.moaReferenceTitle(index + 1)} ${m.model}`}
              className="w-full min-w-0"
              models={modelsForProvider(slot.provider)}
              onValueChange={value =>
                updateMoaPreset(prev => ({
                  ...prev,
                  reference_models: prev.reference_models.map((s, i) =>
                    i === index ? updateMoaSlot(s, { model: value }) : s
                  )
                }))
              }
              provider={findCatalogProvider(providers, slot.provider)}
              providerSlug={slot.provider}
              value={slot.model}
            />

            <div className="model-settings-moa-slot-actions">
              <Switch
                aria-label={m.moaReferenceToggle(slot.enabled !== false, index + 1)}
                checked={slot.enabled !== false}
                disabled={applying}
                onCheckedChange={checked =>
                  updateMoaPreset(prev => ({
                    ...prev,
                    reference_models: prev.reference_models.map((s, i) =>
                      i === index ? { ...s, enabled: checked === true } : s
                    )
                  }))
                }
              />
              <Button
                disabled={currentMoaPreset.reference_models.length <= 1 || applying}
                onClick={() =>
                  updateMoaPreset(prev => ({
                    ...prev,
                    reference_models: prev.reference_models.filter((_, i) => i !== index)
                  }))
                }
                size="sm"
                variant="ghost"
              >
                {t.common.remove}
              </Button>
            </div>
          </div>
        ))}
      </section>
      <section className="model-settings-moa-section">
        <div className="model-settings-subpage-heading">
          <div>
            <h3>{m.moaAggregator}</h3>
            <p>{m.moaAggregatorBilled}</p>
          </div>
        </div>
        <div className="model-settings-moa-aggregator-controls">
          <Select
            onValueChange={value =>
              updateMoaPreset(prev => ({
                ...prev,
                aggregator: updateMoaSlot(prev.aggregator, { provider: value })
              }))
            }
            value={currentMoaPreset.aggregator.provider}
          >
            <SelectTrigger
              aria-label={`${m.moaAggregator} ${m.provider}`}
              className={cn('w-full min-w-0', CONTROL_TEXT)}
            >
              <SelectValue placeholder={m.provider} />
            </SelectTrigger>
            <SelectContent>
              {withActive(
                moaSlotProviderOptions.map(p => p.slug || 'none'),
                currentMoaPreset.aggregator.provider
              ).map(slug => {
                const provider = moaSlotProviderOptions.find(p => (p.slug || 'none') === slug)

                return (
                  <SelectItem key={slug} value={slug}>
                    {provider?.name || slug}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <ModelSelect
            aria-label={`${m.moaAggregator} ${m.model}`}
            className="w-full min-w-0"
            models={modelsForProvider(currentMoaPreset.aggregator.provider)}
            onValueChange={value =>
              updateMoaPreset(prev => ({
                ...prev,
                aggregator: updateMoaSlot(prev.aggregator, { model: value })
              }))
            }
            provider={findCatalogProvider(providers, currentMoaPreset.aggregator.provider)}
            providerSlug={currentMoaPreset.aggregator.provider}
            value={currentMoaPreset.aggregator.model}
          />
        </div>
      </section>
    </>
  )
}
