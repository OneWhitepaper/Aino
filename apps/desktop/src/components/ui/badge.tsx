import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

// Small status/metadata tag. App radius (not a full pill); tones map to the
// shared accent/muted/destructive surfaces so badges read consistently.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-(--aino-radius-control) font-medium leading-none whitespace-nowrap [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary',
        muted: 'bg-muted text-muted-foreground',
        success: 'bg-(--aino-notice-success)/10 text-(--aino-notice-success)',
        warn: 'bg-(--aino-notice-warning)/10 text-(--aino-notice-warning)',
        destructive: 'bg-destructive/10 text-destructive',
        outline: 'border border-(--ui-stroke-secondary) text-muted-foreground',
        // Solid fill — icon-corner counts (titlebar unread, etc.).
        solid: 'bg-primary text-primary-foreground'
      },
      size: {
        default: 'px-1.5 py-0.5 text-[length:var(--aino-text-caption)] [&_svg]:size-3',
        xs: 'px-1 py-0.5 text-[length:var(--aino-text-caption)] [&_svg]:size-3',
        overlay:
          'h-4 min-w-4 justify-center rounded-full px-1 text-[length:var(--aino-text-caption)] font-medium tabular-nums'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

export function Badge({ asChild = false, className, size, variant, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span'

  return <Comp className={cn(badgeVariants({ size, variant }), className)} data-slot="badge" {...props} />
}

export { badgeVariants }
