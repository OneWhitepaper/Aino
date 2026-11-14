import { TITLEBAR_HEIGHT, TOUCH_TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { useMediaQuery } from '@/hooks/use-media-query'
import { hostHas } from '@/lib/host-capabilities'
import { TOUCH_POINTER_QUERY } from '@/lib/touch-interaction'

/** Browser touch chrome retains its 44px targets alongside the desktop band. */
export function useTouchTitlebar(): boolean {
  const touch = useMediaQuery(TOUCH_POINTER_QUERY)

  return hostHas('touchSizedControls') && touch
}

export function useTitlebarHeight(): number {
  return useTouchTitlebar() ? TOUCH_TITLEBAR_HEIGHT : TITLEBAR_HEIGHT
}
