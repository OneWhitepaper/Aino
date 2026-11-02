import { type ComponentProps, useLayoutEffect, useRef } from 'react'

import { hiddenPaneProps } from '../../pane-visibility'

interface PaneLayerProps extends ComponentProps<'div'> {
  active: boolean
}

/** Native inert removes inactive panes from navigation; release any retained keyboard recipient. */
export function PaneLayer({ active, children, ...props }: PaneLayerProps) {
  const element = useRef<HTMLDivElement | null>(null)

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
