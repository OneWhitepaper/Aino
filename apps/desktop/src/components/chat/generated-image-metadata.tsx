import { useI18n } from '@/i18n'
import { imageOutputCopy } from '@/i18n/image-output'
import { generatedImageDetailsFromResult } from '@/lib/generated-images'

interface GeneratedImageMetadataProps {
  result: unknown
}

export function GeneratedImageMetadata({ result }: GeneratedImageMetadataProps) {
  const { locale } = useI18n()
  const copy = imageOutputCopy(locale)
  const details = generatedImageDetailsFromResult(result)

  if (!details || (!details.actual && !details.requested && !details.managed)) {
    return null
  }

  const actual = details.actual ? `${details.actual.width}x${details.actual.height}` : null
  const mismatch = actual && details.requested && actual !== details.requested

  return (
    <div className="mt-2 max-w-full space-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
      <p className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
        <span>
          {copy.actual}：{actual ? `${actual.replace('x', ' × ')} px` : copy.unverified}
        </span>
        {details.requested && (
          <span>
            {copy.requested}：{details.requested.replace('x', ' × ')} px
          </span>
        )}
      </p>
      {mismatch && <p>{copy.mismatch}</p>}
      {details.managed && (
        <p>
          {copy.billingHelp} {copy.billingLink}
        </p>
      )}
    </div>
  )
}
