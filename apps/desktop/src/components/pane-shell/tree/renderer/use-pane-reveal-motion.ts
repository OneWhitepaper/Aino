import { type RefObject, useLayoutEffect } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

/** Reveal the existing host, without moving its native guest or changing focus. */
export function usePaneRevealMotion(
  ref: RefObject<HTMLElement | null>,
  visible: boolean,
  enabled: boolean,
  identity?: string
) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  useLayoutEffect(() => {
    const element = ref.current

    if (!visible || !enabled || reducedMotion || document.visibilityState !== 'visible' || !element?.animate) {
      return
    }

    const animation = element.animate(
      [
        { opacity: 0.86, clipPath: 'inset(0 0 0 0.5rem)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0)' }
      ],
      { duration: 140, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    )

    return () => animation.cancel()
  }, [enabled, identity, reducedMotion, ref, visible])
}
