import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import { SummaryResourceList } from './resource-list'
import type { SummaryResource } from './session-content'
import { SummarySection } from './summary-section'
import type { SummarySession } from './use-summary-session'

interface OutputsSectionProps {
  error: unknown
  items: SummaryResource[]
  loading: boolean
  onRetry: () => void
  session: SummarySession
  showEmpty: boolean
}

export function OutputsSection({ error, items, loading, onRetry, session, showEmpty }: OutputsSectionProps) {
  const { t } = useI18n()

  if (!items.length && !error && !loading && !showEmpty) {
    return null
  }

  const create = () => {
    requestComposerInsert(t.summary.outputs.prompt, { target: session.target })
    requestComposerFocus(session.target)
  }

  return (
    <SummarySection
      action={
        <Tip label={t.summary.outputs.create}>
          <Button
            aria-label={t.summary.outputs.create}
            data-slot="summary-section-action"
            onClick={create}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="add" />
          </Button>
        </Tip>
      }
      state={loading && !items.length ? 'loading' : 'ready'}
      title={t.summary.outputs.title}
    >
      {!items.length && !error ? null : (
        <>
          {items.length > 0 && <SummaryResourceList items={items} session={session} />}
          {Boolean(error) && (
            <div className="flex items-center gap-2 text-(--ui-text-tertiary)">
              <span className="min-w-0 flex-1">{t.summary.state.historyUnavailable}</span>
              <Button onClick={onRetry} size="inline" type="button" variant="text">
                {t.summary.state.retry}
              </Button>
            </div>
          )}
        </>
      )}
    </SummarySection>
  )
}
