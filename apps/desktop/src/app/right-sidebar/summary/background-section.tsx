import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { useSessionSlice } from '@/lib/use-session-slice'
import { $backgroundStatusBySession, dismissBackgroundProcess, stopBackgroundProcess } from '@/store/composer-status'

import { openAgentTerminal } from '../terminal/terminals'

import { SummarySection } from './summary-section'
import { type SummarySession, summarySessionIsCurrent } from './use-summary-session'

export function BackgroundSection({ session }: { session: SummarySession }) {
  const { t } = useI18n()
  const items = useSessionSlice($backgroundStatusBySession, session.runtimeId)

  if (!session.runtimeId || !items.length) {
    return null
  }

  const sid = session.runtimeId

  return (
    <SummarySection title={t.summary.background.title}>
      <div className="grid gap-1">
        {items.map(item => (
          <div className="flex min-w-0 items-center gap-1" key={item.id}>
            <Tip label={item.title}>
              <Button
                className="min-w-0 flex-1 justify-start"
                data-slot="summary-resource-row"
                disabled={!summarySessionIsCurrent(session)}
                onClick={() => {
                  if (!summarySessionIsCurrent(session)) {
                    return
                  }

                  openAgentTerminal(item.id, item.title)
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Codicon name="terminal" />
                <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                <span className="shrink-0 text-(--ui-text-tertiary)" data-slot="summary-row-status">
                  {t.summary.background.status[item.state]}
                </span>
                <Codicon aria-hidden name="chevron-right" size="0.75rem" />
              </Button>
            </Tip>
            <Tip label={item.state === 'running' ? t.statusStack.stop : t.statusStack.dismiss}>
              <Button
                aria-label={item.state === 'running' ? t.statusStack.stop : t.statusStack.dismiss}
                onClick={() => {
                  if (item.state === 'running') {
                    void stopBackgroundProcess(sid, item.id)
                  } else {
                    dismissBackgroundProcess(sid, item.id)
                  }
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Codicon name={item.state === 'running' ? 'debug-stop' : 'close'} />
              </Button>
            </Tip>
          </div>
        ))}
      </div>
    </SummarySection>
  )
}
