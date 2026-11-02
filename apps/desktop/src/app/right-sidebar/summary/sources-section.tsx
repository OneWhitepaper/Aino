import { requestComposerFocus } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import { SummaryResourceList } from './resource-list'
import type { SummaryResource } from './session-content'
import { SummarySection } from './summary-section'
import type { SummarySession } from './use-summary-session'

export function SourcesSection({ items, session }: { items: SummaryResource[]; session: SummarySession }) {
  const { t } = useI18n()

  if (!items.length) {
    return null
  }

  return (
    <SummarySection
      action={
        <Tip label={t.summary.sources.add}>
          <Button
            aria-label={t.summary.sources.add}
            data-slot="summary-section-action"
            onClick={() => requestComposerFocus(session.target, { typeChar: '@' })}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Codicon name="add" />
          </Button>
        </Tip>
      }
      title={t.summary.sources.title}
    >
      <SummaryResourceList items={items} session={session} />
    </SummarySection>
  )
}
