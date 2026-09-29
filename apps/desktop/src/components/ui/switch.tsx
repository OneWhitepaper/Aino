import { cva, type VariantProps } from 'class-variance-authority'
import { Switch as SwitchPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const switchVariants = cva(
  'peer inline-flex shrink-0 items-center rounded-full border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) shadow-none transition-colors outline-none focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-(--aino-action-bg) disabled:data-[state=checked]:bg-(--ui-text-tertiary)',
  {
    variants: {
      size: {
        default: 'h-5 w-9',
        xs: 'h-4 w-7'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const switchThumbVariants = cva(
  'pointer-events-none block rounded-full bg-(--ui-bg-elevated) shadow-xs ring-0 transition-transform data-[state=unchecked]:translate-x-0 data-[state=checked]:bg-(--aino-action-fg)',
  {
    variants: {
      size: {
        default: 'size-4 data-[state=checked]:translate-x-4',
        xs: 'size-3 data-[state=checked]:translate-x-3.5'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

function Switch({
  className,
  size,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants>) {
  return (
    <SwitchPrimitive.Root className={cn(switchVariants({ size }), className)} data-slot="switch" {...props}>
      <SwitchPrimitive.Thumb className={switchThumbVariants({ size })} data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
