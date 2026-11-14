import type { SVGProps } from 'react'

import { WindowChromeIcon } from '@/components/ui/window-chrome-icon'

interface SidebarToggleIconProps extends SVGProps<SVGSVGElement> {
  side?: 'left' | 'right'
  expanded?: boolean
}

/** A single thin-line panel glyph for every sidebar expand/collapse control. */
export function SidebarToggleIcon({ side = 'left', expanded = false, ...props }: SidebarToggleIconProps) {
  return <WindowChromeIcon name={`layout-sidebar-${side}${expanded ? '-collapse' : ''}`} {...props} />
}
