import {
  BookOpen,
  Brain,
  CircleHelp,
  Clock3,
  Eye,
  Files,
  Globe2,
  Image,
  ListTodo,
  type LucideIcon,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal
} from 'lucide-react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

export interface ToolIconProps {
  className?: string
  name: string
  size?: number | string
}

const ACTIVITY_ICONS: Readonly<Record<string, LucideIcon | undefined>> = {
  book: BookOpen,
  'book-open': BookOpen,
  brain: Brain,
  checklist: ListTodo,
  edit: Pencil,
  eye: Eye,
  'file-media': Image,
  files: Files,
  globe: Globe2,
  question: CircleHelp,
  search: Search,
  sparkle: Sparkles,
  terminal: SquareTerminal,
  watch: Clock3
}

/** Transcript actions use light, round-ended strokes; app chrome keeps its own glyphs. */
export function ToolIcon({ className, name, size = '0.875rem' }: ToolIconProps) {
  const Icon = Object.hasOwn(ACTIVITY_ICONS, name) ? ACTIVITY_ICONS[name] : undefined
  const activityClass = cn('inline-block shrink-0 align-middle', className)
  const style = { width: size, height: size }

  if (Icon) {
    return <Icon aria-hidden="true" className={activityClass} size="1em" strokeWidth={1.65} style={style} />
  }

  if (name === 'tools') {
    return (
      <svg
        aria-hidden="true"
        className={activityClass}
        fill="none"
        height="1em"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.65}
        style={style}
        viewBox="0 0 24 24"
        width="1em"
      >
        <path d="m8.2 8.2 7.6 7.6m-7.6 0 7.6-7.6" />
        <circle cx="6" cy="6" r="3.2" />
        <circle cx="18" cy="6" r="3.2" />
        <circle cx="6" cy="18" r="3.2" />
        <circle cx="18" cy="18" r="3.2" />
      </svg>
    )
  }

  return <Codicon className={cn('shrink-0', className)} name={name} size={size} />
}
