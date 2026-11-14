import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import { titlebarButtonClass } from './titlebar'
import { TitlebarIcon } from './titlebar-icon'
import type { TitlebarHistoryState } from './use-titlebar-history'

interface TitlebarHistoryControlsProps {
  history: TitlebarHistoryState
}

export function TitlebarHistoryControls({ history }: TitlebarHistoryControlsProps) {
  const { t } = useI18n()

  return (
    <>
      <Tip label={t.preview.web.goBack} placement="toolbar">
        <Button
          aria-label={t.preview.web.goBack}
          className={titlebarButtonClass}
          disabled={!history.canBack}
          onClick={history.back}
          onPointerDown={event => event.stopPropagation()}
          size="icon-titlebar"
          type="button"
          variant="ghost"
        >
          <TitlebarIcon name="arrow-left" />
        </Button>
      </Tip>
      <Tip label={t.preview.web.goForward} placement="toolbar">
        <Button
          aria-label={t.preview.web.goForward}
          className={titlebarButtonClass}
          disabled={!history.canForward}
          onClick={history.forward}
          onPointerDown={event => event.stopPropagation()}
          size="icon-titlebar"
          type="button"
          variant="ghost"
        >
          <TitlebarIcon name="arrow-right" />
        </Button>
      </Tip>
    </>
  )
}
