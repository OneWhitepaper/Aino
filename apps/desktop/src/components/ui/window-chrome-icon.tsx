import {
  ArrowLeft,
  ArrowRight,
  createLucideIcon,
  LoaderCircle,
  type LucideIcon,
  PanelBottom,
  PanelBottomDashed,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  X
} from 'lucide-react'
import type { SVGProps } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

// Match the panel glyphs' 3–21 drawing bounds, rather than letting the
// speech tail and bell crown make adjacent 18px icons read at different sizes.
const WindowNotification = createLucideIcon('WindowNotification', [
  [
    'path',
    { d: 'M18 9a6 6 0 0 0-12 0c0 4-1.2 5.5-2.5 7a.6.6 0 0 0 .5 1h16a.6.6 0 0 0 .5-1C19.2 14.5 18 13 18 9', key: 'bell' }
  ],
  ['path', { d: 'M10 20a2.25 2.25 0 0 0 4 0', key: 'clapper' }]
])

const WindowChat = createLucideIcon('WindowChat', [
  ['path', { d: 'M21 16a2 2 0 0 1-2 2H7l-4 3V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', key: 'bubble' }],
  ['path', { d: 'M8 10.5h.01M12 10.5h.01M16 10.5h.01', key: 'dots' }]
])

const SessionResources = createLucideIcon('SessionResources', [
  ['circle', { cx: '6', cy: '6', r: '2.5', key: 'first-marker' }],
  ['path', { d: 'M13 6h8', key: 'first-line' }],
  ['circle', { cx: '6', cy: '18', r: '2.5', key: 'second-marker' }],
  ['path', { d: 'M13 18h8', key: 'second-line' }]
])

const WINDOW_ICONS: Readonly<Record<string, LucideIcon | undefined>> = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bell: WindowNotification,
  close: X,
  hud: WindowChat,
  'layout-panel': PanelBottom,
  'layout-panel-off': PanelBottomDashed,
  'layout-sidebar-left': PanelLeftOpen,
  'layout-sidebar-left-collapse': PanelLeftClose,
  'layout-sidebar-right': PanelRightOpen,
  'layout-sidebar-right-collapse': PanelRightClose,
  list: SessionResources,
  loading: LoaderCircle,
  refresh: RotateCw
}

interface WindowChromeIconProps extends SVGProps<SVGSVGElement> {
  name: string
  size?: number | string
  spinning?: boolean
}

/** Window actions share one optical size and outline, independently of editor glyphs. */
export function WindowChromeIcon({ className, name, size, spinning, style, ...props }: WindowChromeIconProps) {
  const Icon = Object.hasOwn(WINDOW_ICONS, name) ? WINDOW_ICONS[name] : undefined

  if (!Icon) {
    return <Codicon className={className} name={name} size={size} spinning={spinning} />
  }

  return (
    <Icon
      aria-hidden="true"
      className={cn('block shrink-0', spinning && 'animate-spin', className)}
      focusable="false"
      size={size ?? 18}
      strokeWidth={1.65}
      style={size == null ? style : { width: size, height: size, ...style }}
      {...props}
    />
  )
}
