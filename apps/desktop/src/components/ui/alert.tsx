import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-(--aino-radius-control) border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-4 py-3 text-[length:var(--aino-text-body)] text-foreground shadow-none [overflow-wrap:anywhere] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-(--ui-stroke-tertiary)',
        destructive: 'border-(--ui-stroke-tertiary) [&>svg]:text-destructive',
        warning: 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) [&>svg]:text-(--ui-yellow)',
        success: 'border-(--ui-stroke-tertiary) bg-(--ui-bg-quaternary) [&>svg]:text-(--ui-green)'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      className={cn(alertVariants({ variant }), className)}
      data-slot="alert"
      data-variant={variant ?? 'default'}
      role="alert"
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-2 min-w-0 min-h-4 font-medium tracking-tight text-foreground [overflow-wrap:anywhere]',
        className
      )}
      data-slot="alert-title"
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'col-start-2 grid min-w-0 grid-cols-[minmax(0,1fr)] justify-items-start gap-1 text-(--ui-text-secondary) [overflow-wrap:anywhere] [&_p]:leading-relaxed',
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
