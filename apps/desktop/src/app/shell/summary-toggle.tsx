import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { WindowChromeIcon } from '@/components/ui/window-chrome-icon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { $summaryOpen, toggleSummary } from '@/store/summary'

export function SummaryToggle() {
  const { t } = useI18n()
  const open = useStore($summaryOpen)

  return (
    <Tip label={t.summary.title} placement="toolbar">
      <Button
        aria-controls="session-summary"
        aria-expanded={open}
        aria-label={t.summary.title}
        aria-pressed={open}
        data-state={open ? 'open' : 'closed'}
        onClick={() => {
          triggerHaptic('tap')
          toggleSummary()
        }}
        onPointerDown={event => event.stopPropagation()}
        size="icon-titlebar"
        type="button"
        variant="titlebar-popover"
      >
        <WindowChromeIcon name="list" />
      </Button>
    </Tip>
  )
}
