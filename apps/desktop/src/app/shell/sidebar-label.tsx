import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SidebarPanelLabelProps extends React.ComponentProps<'span'> {
  dotClassName?: string
  tone?: 'accent' | 'neutral'
  meta?: React.ReactNode
}

export function SidebarPanelLabel({
  children,
  className,
  dotClassName,
  tone = 'accent',
  meta,
  ...props
}: SidebarPanelLabelProps) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-2 pl-2 text-[length:var(--aino-text-caption)] font-normal text-(--ui-text-tertiary)',
        className
      )}
      data-sidebar-label-tone={tone}
      {...props}
    >
      {dotClassName && (
        <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', dotClassName)} />
      )}
      <span className="min-w-0 truncate leading-relaxed">{children}</span>
      {meta && (
        <span className="shrink-0 text-[length:var(--aino-text-caption)] font-medium tracking-normal text-(--ui-text-quaternary)">
          {meta}
        </span>
      )}
    </span>
  )
}
