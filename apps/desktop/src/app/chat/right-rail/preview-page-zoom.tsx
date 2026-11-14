import { type RefObject, useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { notifyError } from '@/store/notifications'

export type PreviewPageZoomValue = 'fit' | number
export interface PreviewZoomGuest {
  getZoomFactor?: () => number
  getPageZoomMode?: () => 'fit' | 'manual'
  setPageZoom?: (value: PreviewPageZoomValue) => Promise<unknown>
}

/** Read the page's own zoom, never the desktop's UI scale. */
export function usePreviewPageZoom(guestRef: RefObject<PreviewZoomGuest | null>) {
  const { t } = useI18n()
  const [state, setState] = useState({ available: false, factor: 1, mode: 'fit' as 'fit' | 'manual' })

  const syncPageZoom = useCallback(() => {
    const guest = guestRef.current
    const factor = guest?.getZoomFactor?.() ?? 1
    const next = { available: Boolean(guest?.setPageZoom), factor, mode: guest?.getPageZoomMode?.() ?? 'fit' }
    setState(before => before.available === next.available && before.factor === next.factor && before.mode === next.mode ? before : next)
  }, [guestRef])

  const selectPageZoom = useCallback(async (value: PreviewPageZoomValue) => {
    const guest = guestRef.current
    await guest?.setPageZoom?.(value)

    if (guestRef.current === guest) { syncPageZoom() }
  }, [guestRef, syncPageZoom])

  const onSetPageZoom = useCallback((value: PreviewPageZoomValue) => {
    void selectPageZoom(value).catch(error => notifyError(error, t.preview.unavailable))
  }, [selectPageZoom, t.preview.unavailable])

  return {
    syncPageZoom,
    browserBarProps: {
      pageZoom: state.factor,
      pageZoomMode: state.mode,
      onSetPageZoom: state.available ? onSetPageZoom : undefined
    }
  }
}

interface PreviewPageZoomProps {
  factor: number
  mode: 'fit' | 'manual'
  onChange?: (value: PreviewPageZoomValue) => void
}

export function PreviewPageZoom({ factor, mode, onChange }: PreviewPageZoomProps) {
  const { t } = useI18n()
  const copy = t.preview.web
  const percent = `${Math.round(factor * 100)}%`

  if (!onChange) {return null}

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`${copy.pageZoom}: ${percent}`} className="shrink-0 font-normal tabular-nums text-muted-foreground" size="xs" variant="ghost">
          {percent}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={() => onChange('fit')}>
          {copy.fitWidth}
          {mode === 'fit' && <Codicon className="ml-auto" name="check" size="0.75rem" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(1)}>
          {copy.actualSize}
          {mode === 'manual' && factor === 1 && <Codicon className="ml-auto" name="check" size="0.75rem" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={factor <= 0.25} onSelect={() => onChange(Math.max(0.25, Math.round((factor - 0.1) * 100) / 100))}>
          <Codicon name="remove" size="0.75rem" />{copy.zoomOut}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={factor >= 3} onSelect={() => onChange(Math.min(3, Math.round((factor + 0.1) * 100) / 100))}>
          <Codicon name="add" size="0.75rem" />{copy.zoomIn}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
