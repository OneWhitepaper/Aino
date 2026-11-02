import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'

import type { PlatformModel } from '../../../shared/platform-contract'

interface AinoImageQualityProps {
  model: PlatformModel
  quality: string | null
  disabled: boolean
  configurable: boolean
  onChange: (quality: string | null) => void
}

export function resolveAinoImageQuality(model: PlatformModel, quality: string | null) {
  return quality ?? (model.capabilities.image_quality_options?.includes('auto') ? 'auto' : null)
}

export function AinoImageQuality({ model, quality, disabled, configurable, onChange }: AinoImageQualityProps) {
  const { t } = useI18n()
  const copy = t.settings.model.imageGeneration
  const options = model.capabilities.image_quality_options ?? []
  const selectedQuality = resolveAinoImageQuality(model, quality)
  const unsupported = selectedQuality !== null && !options.includes(selectedQuality as (typeof options)[number])

  return (
    <div aria-label={copy.qualityTitle} className="grid gap-2 border-t border-(--ui-stroke-tertiary) pt-4" role="group">
      <div>
        <p className="text-sm font-medium">{copy.qualityTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.qualityHint}</p>
      </div>
      {configurable && unsupported && (
        <p className="text-xs text-destructive" role="alert">
          {copy.qualityUnsupported}
        </p>
      )}
      {!configurable ? (
        <p className="text-xs text-muted-foreground" role="status">
          {copy.qualityRuntimeUnavailable}
        </p>
      ) : options.length > 0 || unsupported ? (
        <div className="max-w-full overflow-x-auto pb-1">
          <SegmentedControl
            disabled={disabled}
            onChange={value => onChange(value === 'default' ? null : value)}
            options={[
              ...(options.includes('auto') ? [] : [{ id: 'default', label: copy.qualityDefault }]),
              ...options.map(value => ({ id: value, label: copy.qualityLabels[value] }))
            ]}
            value={unsupported ? '' : (selectedQuality ?? 'default')}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.qualityUnavailable}</p>
      )}
    </div>
  )
}
