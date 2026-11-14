import { useI18n } from '@/i18n'

import type { PlatformModel } from '../../shared/platform-contract'

/** The API already applies this account's group override and current peak rate. */
export function PlatformModelRate({ model }: { model: PlatformModel }) {
  const { t } = useI18n()
  const rate = model.pricing.effective_user_rate.trim()

  // Image billing uses an independent multiplier; this catalog field is for chat.
  if (model.purpose === 'image' || !/^\d+(?:\.\d+)?$/.test(rate)) {
    return null
  }

  const label = `${rate
    .replace(/^0+(?=\d)/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')}×`

  const description = `${t.platformModels.rate}: ${label}`

  return (
    <span
      aria-label={description}
      className="shrink-0 whitespace-nowrap text-[length:var(--aino-text-caption)] text-muted-foreground tabular-nums"
      title={description}
    >
      {label}
    </span>
  )
}
