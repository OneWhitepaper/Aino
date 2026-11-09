import type { Icon as IconComponent, IconProps } from '@tabler/icons-react'
import {
  IconEar as Ear,
  IconEarOff as EarOff,
  IconPlayerEjectFilled as Eject,
  IconGitBranch as GitBranch,
  IconGitFork as GitFork,
  IconPaw as PawPrint,
  IconChartDots3 as Starmap
} from '@tabler/icons-react'
import { createElement, forwardRef } from 'react'

import codiconIconNodes from '@/assets/aino-icons/codicon-nodes.json'
import approvedIconNodes from '@/assets/aino-icons/icon-park-nodes.json'

interface IconNode {
  tag: string
  attrs: Record<string, string>
  children: IconNode[]
}

interface OfficialIcon {
  viewBox: string
  nodes: IconNode[]
}

function renderIconNode(node: IconNode, key: number): React.ReactNode {
  return createElement(node.tag, { ...node.attrs, key }, node.children.map(renderIconNode))
}

/** Official Codicon geometry matches the approved comp without a runtime library.
 * Specialty symbols keep their existing semantic shape at the same optical weight. */
function designIcon(name: keyof typeof approvedIconNodes) {
  const official = (codiconIconNodes as Record<string, OfficialIcon>)[name]

  const Icon = forwardRef<SVGSVGElement, IconProps>(function ApprovedIcon(
    { children, className, color = 'currentColor', size = 24, stroke = 3, strokeWidth = stroke, title, ...props },
    ref
  ) {
    return createElement(
      'svg',
      {
        'aria-hidden': title || props['aria-label'] || props['aria-labelledby'] ? undefined : true,
        className,
        color,
        'data-aino-icon': name,
        'data-aino-icon-family': official ? 'codicon' : 'specialty',
        fill: official ? 'currentColor' : 'none',
        height: size,
        ref,
        stroke: official ? 'none' : 'currentColor',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        strokeWidth,
        viewBox: official?.viewBox ?? '0 0 16 16',
        width: size,
        ...props
      },
      title && createElement('title', {}, title),
      official
        ? official.nodes.map(renderIconNode)
        : createElement(
            'g',
            { transform: 'scale(0.3333333333333333)' },
            (approvedIconNodes[name] as IconNode[]).map(renderIconNode),
            children
          ),
      official ? children : null
    )
  })

  Icon.displayName = name

  return Icon
}

export const Activity = designIcon('ActivitySource')
export const AlertCircle = designIcon('Attention')
export const AlertTriangle = designIcon('Caution')
export const AppWindow = designIcon('Application')
export const Archive = designIcon('Inbox')
export const ArchiveOff = designIcon('InboxOut')
export const ArrowBarToDown = designIcon('ToBottom')
export const ArrowBarToUp = designIcon('ToTop')
export const ArrowDown = designIcon('ArrowDown')
export const ArrowLeft = designIcon('ArrowLeft')
export const ArrowRight = designIcon('ArrowRight')
export const ArrowUp = designIcon('ArrowUp')
export const ArrowUpRight = designIcon('ArrowRightUp')
export const AtSign = designIcon('AtSign')
export const AudioLines = designIcon('SoundWave')
export const BarChart3 = designIcon('ChartHistogram')
export const Bell = designIcon('Remind')
export const Book = designIcon('BookOpen')
export const Bookmark = designIcon('Bookmark')
export const BookmarkFilled = designIcon('BookmarkFilled')
export const Box = AppWindow
export const Brain = designIcon('Brain')
export const Bug = designIcon('Bug')
export const Check = designIcon('Check')
export const CheckCircle2 = designIcon('CheckOne')
export const CheckIcon = Check
export const ChevronDown = designIcon('Down')
export const ChevronDownIcon = ChevronDown
export const ChevronLeft = designIcon('Left')
export const ChevronLeftIcon = ChevronLeft
export const ChevronRight = designIcon('Right')
export const ChevronRightIcon = ChevronRight
export const ChevronUp = designIcon('Up')
export const CircleIcon = designIcon('Round')
export const CircleLetterA = designIcon('Text')
export const Clipboard = designIcon('Clipboard')
export const Clock = designIcon('AlarmClock')
export const Cloud = designIcon('Cloudy')
export const Code = designIcon('Code')
export const Command = designIcon('Command')
export const Copy = designIcon('Copy')
export const CopyIcon = Copy
export const CornerDownLeft = designIcon('CornerDownLeft')
export const Cpu = designIcon('Cpu')
export const CreditCard = designIcon('BankCard')
export const Download = designIcon('Download')
export const Egg = designIcon('Egg')
export const ExternalLink = designIcon('Share')
export const Eye = designIcon('PreviewOpen')
export const EyeOff = designIcon('PreviewClose')
export const FileImage = designIcon('Pic')
export const FilePlus = designIcon('FileAddition')
export const FileCode = designIcon('FileCode')
export const FileText = designIcon('FileText')
export const FolderClosed = designIcon('FolderClose')
export const FolderPlus = designIcon('FolderPlus')
export const FolderOpen = designIcon('FolderOpen')
export const Home = designIcon('Home')
export const Data = designIcon('Data')
export const Robot = designIcon('Robot')
export const Globe = designIcon('Globe')
export const Hash = designIcon('Pound')
export const HelpCircle = designIcon('Help')
export const ImageIcon = FileImage
export const Info = designIcon('Info')
export const Keyboard = designIcon('Keyboard')
export const KeyRound = designIcon('Key')
export const Layers3 = designIcon('Layers')
export const LayoutDashboard = AppWindow
export const Link = designIcon('LinkOne')
export const Link2 = Link
export const LinkIcon = Link
export const List = designIcon('List')
export const ListPlus = designIcon('ListAdd')
export const Loader2 = designIcon('Loading')
export const Loader2Icon = Loader2
export const Lock = designIcon('Lock')
export const LockOpen = designIcon('Unlock')
export const LogIn = designIcon('Login')
export const Camera = designIcon('Camera')
export const Calendar = designIcon('Calendar')
export const Compass = designIcon('Compass')
export const CollapseAll = designIcon('CollapseTextInput')
export const Grip = designIcon('Drag')
export const Minus = designIcon('Minus')
export const Paperclip = designIcon('Paperclip')
export const Reply = designIcon('Return')
export const Split = designIcon('Split')
export const Star = designIcon('Star')
export const Switch = designIcon('Switch')
export const Target = designIcon('Target')
export const TreeList = designIcon('TreeList')
export const Unplug = designIcon('LinkBreak')
export const Next = designIcon('Next')
export const TextSize = designIcon('Text')
export const Mail = designIcon('Mail')
export const Maximize = designIcon('FullScreen')
export const MessageCircle = designIcon('Comment')
export const MessageCode = designIcon('Message')
export const MessageQuestion = designIcon('MessageFailed')
export const MessageSquareText = MessageCircle
export const Mic = designIcon('Voice')
export const MicOff = designIcon('VoiceOff')
export const Monitor = designIcon('Computer')
export const MonitorPlay = designIcon('FullScreenPlay')
export const Moon = designIcon('Moon')
export const MoreHorizontal = designIcon('More')
export const MoreHorizontalIcon = MoreHorizontal
export const MoreVertical = designIcon('MoreOne')
export const Network = designIcon('NetworkTree')
export const NotebookTabs = designIcon('Notebook')
export const Package = designIcon('Box')
export const Palette = designIcon('ColorFilter')
export const PanelBottom = designIcon('LayoutThree')
export const PanelLeftIcon = designIcon('ExpandRight')
export const PanelTop = designIcon('LayoutTwo')
export const Pause = designIcon('Pause')
export const Pencil = designIcon('Edit')
export const PencilIcon = Pencil
export const PencilLine = Pencil
export const Pin = designIcon('Pushpin')
export const Play = designIcon('Play')
export const PlayFilled = designIcon('PlayFilled')
export const Plug = designIcon('Link')
export const Plus = designIcon('Plus')
export const Power = designIcon('Power')
export const QrCode = designIcon('TwoDimensionalCode')
export const RefreshCw = designIcon('Refresh')
export const RefreshCwIcon = RefreshCw
export const Save = designIcon('Save')
export const Search = designIcon('Search')
export const SearchIcon = Search
export const Send = designIcon('Send')
export const Settings = designIcon('SettingTwo')
export const Settings2 = designIcon('SettingConfig')
export const ShieldLock = designIcon('Shield')
export const SlidersHorizontal = Settings2
export const SmilePlusIcon = designIcon('SmilingFace')
export const Square = designIcon('Square')
export const SquarePen = Pencil
export const SteeringWheel = designIcon('SteeringWheel')
export const StopFilled = designIcon('SquareFilled')
export const Sun = designIcon('Sun')
export const Terminal = designIcon('Terminal')
export const Trash2 = designIcon('Delete')
export const Upload = designIcon('Upload')
export const UserCircle = designIcon('User')
export const Users = designIcon('Peoples')
export const Volume2 = designIcon('VolumeSmall')
export const Volume2Icon = Volume2
export const VolumeX = designIcon('VolumeMute')
export const VolumeXIcon = VolumeX
export const Wrench = designIcon('Tool')
export const X = designIcon('Close')
export const XIcon = X
export const Zap = designIcon('Lightning')
export const ZapFilled = designIcon('LightningFilled')
export const ZoomIn = designIcon('ZoomIn')
export const ZoomOut = designIcon('ZoomOut')

export { Ear, EarOff, Eject, GitBranch, GitFork, PawPrint, Starmap }
export const GitBranchIcon = GitBranch
export const GitForkIcon = GitFork
export type { IconComponent }

/**
 * Named icon-size scale — the single source of truth for SVG icon dimensions,
 * replacing ad-hoc `h-N w-N` / `size={N}`. Use `<Icon className={iconSize.sm} />`
 * (Tailwind `size-*` sets w+h and beats the icon's default 24px); compose with
 * `cn()` for colour/animation classes.
 */
export const iconSize = {
  xs: 'size-3', // 12px
  sm: 'size-3.5', // 14px
  md: 'size-4', // 16px
  lg: 'size-5', // 20px
  xl: 'size-6' // 24px
} as const

export type IconSize = keyof typeof iconSize
