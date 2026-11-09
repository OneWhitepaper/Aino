import * as React from 'react'

import { Codicon, type CodiconProps } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

/**
 * Rounded surface for fenced code (and any equivalent: diffs, raw payloads,
 * etc.) sized for the conversation column. Ordinary code stays compact;
 * source documents can add the shared header for their label and actions.
 */
function CodeCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'group/code relative min-w-0 max-w-full overflow-hidden rounded-[0.625rem] bg-(--ui-bg-editor) [--expandable-fade-from:var(--ui-bg-editor)] text-[length:var(--conversation-tool-font-size)] text-muted-foreground',
        className
      )}
      data-slot="code-card"
      {...props}
    />
  )
}

function CodeCardIcon({ className, ...props }: CodiconProps) {
  return (
    <Codicon
      className={cn('shrink-0 text-[0.875rem] leading-none text-muted-foreground', className)}
      data-slot="code-card-icon"
      {...props}
    />
  )
}

function CodeCardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3 py-1.5 font-sans text-xs font-medium text-muted-foreground',
        className
      )}
      data-slot="code-card-header"
      {...props}
    />
  )
}

function CodeCardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'font-mono text-[length:calc(0.7rem*var(--conversation-text-scale,1))] leading-relaxed text-foreground/90 [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:scrollbar-overlay [&_pre]:bg-transparent! [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:leading-relaxed',
        className
      )}
      data-slot="code-card-body"
      {...props}
    />
  )
}

export { CodeCard, CodeCardBody, CodeCardHeader, CodeCardIcon }
