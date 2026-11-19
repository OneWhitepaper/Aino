import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { executionMode } from '@/lib/execution-mode'

export function ExecutionModeBadge({ mode }: { mode?: 'work' | 'code' }) {
  const { t } = useI18n()
  const value = executionMode(mode)

  return (
    <Badge aria-label={t.executionMode[value]} size="xs" variant="muted">
      {t.executionMode[`${value}Label`]}
    </Badge>
  )
}
