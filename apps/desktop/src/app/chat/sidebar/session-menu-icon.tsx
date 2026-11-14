import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRight,
  CopyX,
  createLucideIcon,
  Eye,
  EyeClosed,
  GitBranch,
  PanelTop,
  Pencil,
  PinOff,
  RotateCw,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'

// Keep the reference's diagonal pin inside the same 24px drawing box.
const SessionPin = createLucideIcon('SessionPin', [
  ['path', { d: 'M12 17v5', transform: 'rotate(45 12 12)', key: 'stem' }],
  [
    'path',
    {
      d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
      transform: 'rotate(45 12 12)',
      key: 'head'
    }
  ]
])

const SessionCopy = createLucideIcon('SessionCopy', [
  ['rect', { x: '2.5', y: '8', width: '13.5', height: '13.5', rx: '3', key: 'front' }],
  ['path', { d: 'M8 8V5.5a3 3 0 0 1 3-3h7.5a3 3 0 0 1 3 3V13a3 3 0 0 1-3 3H16', key: 'back' }]
])

const SessionNewWindow = createLucideIcon('SessionNewWindow', [
  ['path', { d: 'M10 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5', key: 'window' }],
  ['path', { d: 'M7 7h.01M10.5 7h.01M14 7h.01', key: 'dots' }],
  ['path', { d: 'M18.5 14.5v8m-4-4h8', key: 'plus' }]
])

const SessionProject = createLucideIcon('SessionProject', [
  ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v2M3 9h14', key: 'folder' }],
  ['path', { d: 'M12 17h10m-3-3 3 3-3 3', key: 'arrow' }]
])

const SESSION_MENU_ICONS = {
  archive: Archive,
  'archive-restore': ArchiveRestore,
  'arrow-right': ArrowRight,
  browser: PanelTop,
  'clear-all': CopyX,
  close: X,
  'close-all': CopyX,
  'cloud-download': ArrowDownToLine,
  copy: SessionCopy,
  edit: Pencil,
  'eye-closed': EyeClosed,
  folder: SessionProject,
  'link-external': SessionNewWindow,
  mail: Eye,
  'mail-read': EyeClosed,
  pin: SessionPin,
  'pin-off': PinOff,
  refresh: RotateCw,
  'repo-forked': GitBranch,
  terminal: SquareTerminal,
  trash: Trash2
} as const

export type SessionMenuIconName = keyof typeof SESSION_MENU_ICONS

interface SessionMenuIconProps {
  name: SessionMenuIconName
}

/** One outline family for session dropdowns and their matching context menus. */
export function SessionMenuIcon({ name }: SessionMenuIconProps) {
  const Icon = SESSION_MENU_ICONS[name]

  return <Icon aria-hidden="true" className="size-4 shrink-0 text-current" focusable="false" strokeWidth={1.75} />
}
