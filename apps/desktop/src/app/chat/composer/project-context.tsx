import type { ComponentProps } from 'react'

import { CodingStatusRow } from './status-stack/coding-row'
import { StatusDrawerContent } from './status-stack/drawer'

interface ComposerProjectContextProps extends ComponentProps<typeof CodingStatusRow> {
  collapsed: boolean
  drawerId: string
  homeLayout: boolean
  hudMode: boolean
  placement: 'footer' | 'surface' | 'menu'
  poppedOut: boolean
  shown: boolean
}

/** One live project/Git row; conversation cards put its chrome in the underside. */
export function ComposerProjectContext({
  collapsed,
  drawerId,
  homeLayout,
  hudMode,
  placement,
  poppedOut,
  shown,
  ...actions
}: ComposerProjectContextProps) {
  const footer = !homeLayout && !poppedOut && !hudMode

  if (placement === 'menu') {
    return shown ? <CodingStatusRow {...actions} presentation="menu" /> : null
  }

  if (!shown || footer !== (placement === 'footer')) {
    return null
  }

  const content = (
    <StatusDrawerContent collapsed={collapsed} id={drawerId}>
      <CodingStatusRow {...actions} />
    </StatusDrawerContent>
  )

  return footer ? <div data-slot="composer-project-footer">{content}</div> : content
}
