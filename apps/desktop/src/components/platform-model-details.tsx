import { useI18n } from '@/i18n'

import type { PlatformModel } from '../../shared/platform-contract'

export function PlatformModelDetails({ model }: { model: PlatformModel }) {
  const { t } = useI18n()
  const c = t.platformModels
  const p = model.pricing
  const image = model.purpose === 'image'

  if (image) {
    return (
      <div className="space-y-2 pt-2 text-xs text-muted-foreground">
        <p className="break-words">{model.display_name}</p>
        <p>{t.settings.model.imageGeneration.billingRules}</p>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <dt>{t.settings.model.imageGeneration.title}</dt>
          <dd>{model.capabilities.image_generation === true ? c.supported : c.unsupportedCapability}</dd>
        </dl>
      </div>
    )
  }

  const fields = [
    [c.input, p.input],
    [c.output, p.output],
    [c.cacheRead, p.cache_read],
    [c.cacheWrite, p.cache_write],
    [c.rate, p.effective_user_rate],
    [c.context, model.context_window?.toLocaleString()],
    ...(['tools', 'vision', 'reasoning'] as const).map(key => [
      c[key],
      model.capabilities[key] ? c.supported : c.unsupportedCapability
    ])
  ]

  return (
    <div className="max-h-60 space-y-2 overflow-y-auto pt-2 text-xs text-muted-foreground">
      <p className="break-words">
        {model.display_name} · {p.currency} / {p.unit}
      </p>
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {fields.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt>{label}</dt>
            <dd className="break-words text-right">{value ?? c.unknown}</dd>
          </div>
        ))}
      </dl>
      {p.tiers.length > 0 && (
        <div>
          <p>{c.tiers}</p>
          {p.tiers.map(tier => (
            <p className="break-words" key={tier.min_tokens}>
              {tier.label || `${tier.min_tokens} - ${tier.max_tokens ?? '+'}`}: {c.input} {tier.input ?? c.unknown},{' '}
              {c.output} {tier.output ?? c.unknown}, {c.cacheRead} {tier.cache_read ?? c.unknown}, {c.cacheWrite}{' '}
              {tier.cache_write ?? c.unknown}
            </p>
          ))}
        </div>
      )}
      {p.time_pricing && (
        <div>
          <p>
            {c.timePricing} · {p.time_pricing.timezone}
          </p>
          {p.time_pricing.periods.map(period => (
            <p key={period.start_time}>
              {period.start_time} - {period.end_time}: {period.multiplier}x
            </p>
          ))}
        </div>
      )}
      {p.group_peak && (
        <p>
          {c.groupPeak}: {p.group_peak.start} - {p.group_peak.end}: {p.group_peak.multiplier}x
        </p>
      )}
    </div>
  )
}
