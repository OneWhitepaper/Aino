import { useI18n } from '@/i18n'
import { imageOutputCopy } from '@/i18n/image-output'

import type { PlatformUsageRow } from '../../../../shared/platform-contract'

const IMAGE_BILLING_TIERS = new Set(['1K', '2K', '4K'])

function sizeLabel(value: string | null | undefined, unknown: string): string {
  return value && /^\d+x\d+$/.test(value) ? `${value.replace('x', ' × ')} px` : value || unknown
}

interface UsageImageDetailsProps {
  row: PlatformUsageRow
  compact?: boolean
}

export function UsageImageDetails({ row, compact = false }: UsageImageDetailsProps) {
  const { t, locale } = useI18n()
  const copy = imageOutputCopy(locale)
  const unknown = t.platformBillingHistory.unknown

  if (row.desktop_purpose !== 'image' && !row.image_count && !row.image_output_size) {
    return null
  }

  const tiers = Object.entries(row.image_size_breakdown ?? {})
    // The API also keeps reserved counters such as image_cache_read_tokens in this map.
    .filter(([tier, count]) => IMAGE_BILLING_TIERS.has(tier) && Number.isSafeInteger(count) && count > 0)
    .map(([tier, count]) => `${tier} × ${count.toLocaleString(locale)}`)

  const recordedTier = row.image_size && IMAGE_BILLING_TIERS.has(row.image_size) ? row.image_size : unknown
  const tier = tiers.join(' · ') || recordedTier

  const source =
    row.image_size_source && Object.hasOwn(copy.sources, row.image_size_source)
      ? copy.sources[row.image_size_source]
      : unknown

  const fields = [
    [copy.count, row.image_count == null ? unknown : row.image_count.toLocaleString(locale)],
    [
      copy.requested,
      row.image_input_size === 'auto'
        ? t.settings.model.imageGeneration.qualityLabels.auto
        : sizeLabel(row.image_input_size, unknown)
    ],
    [copy.output, sizeLabel(row.image_output_size, unknown)],
    [copy.tier, tier],
    [copy.basis, source]
  ]

  if (compact) {
    return (
      <div className="col-span-2 space-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        <p>
          {copy.output}: {sizeLabel(row.image_output_size, unknown)} · {copy.tier}: {tier}
        </p>
        <p>
          {copy.basis}: {source}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <dl className="account-usage-counters">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 tabular-nums [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{copy.billingHelp}</p>
    </div>
  )
}
