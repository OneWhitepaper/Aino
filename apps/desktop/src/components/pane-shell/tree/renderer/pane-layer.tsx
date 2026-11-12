import { type ComponentProps, useLayoutEffect, useRef } from 'react'

import { hiddenPaneProps } from '../../pane-visibility'

import { usePaneRevealMotion } from './use-pane-reveal-motion'

interface PaneLayerProps extends ComponentProps<'div'> {
  active: boolean
  animated?: boolean
}

/** Native inert removes inactive panes from navigation; release any retained keyboard recipient. */
export function PaneLayer({ active, animated = false, children, ...props }: PaneLayerProps) {
  const element = useRef<HTMLDivElement | null>(null)
  usePaneRevealMotion(element, active, animated)

  useLayoutEffect(() => {
    const focused = element.current?.ownerDocument.activeElement

    if (!active && focused instanceof HTMLElement && element.current?.contains(focused)) {
      focused.blur()
    }
  }, [active])

  return (
    <div {...props} {...hiddenPaneProps(!active)} inert={!active || undefined} ref={element}>
      {children}
    </div>
  )
}
