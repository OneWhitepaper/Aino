import { cva, type VariantProps } from 'class-variance-authority'
import { Popover as PopoverPrimitive } from 'radix-ui'
import * as React from 'react'

import { CARD_SURFACE_CLASS } from '@/components/ui/card-surface'
import { usePopoverPortalContainer } from '@/components/ui/dialog-portal-context'
import { cn } from '@/lib/utils'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

// The arrow shares its variant's surface so it cannot acquire a different fill.
const popoverContentVariants = cva(
  'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-(--aino-radius-panel) p-2 outline-hidden data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  {
    variants: {
      variant: {
        // The same paper and elevation as menus. The arrow reads this exact
        // variable as well, so panel and arrow never acquire different fills.
        default:
          'border border-(--stroke-nous) bg-(--popover-surface) text-popover-foreground shadow-nous [--popover-surface:var(--ui-bg-elevated)]',
        // A high-emphasis announcement uses the same graphite/inverse pair as
        // the primary action. Its arrow stays borderless and shares the fill.
        accent: 'bg-(--popover-surface) text-(--aino-action-fg) shadow-nous [--popover-surface:var(--aino-action-bg)]',
        card: cn(CARD_SURFACE_CLASS, 'w-80 p-0 [--popover-surface:var(--ui-bg-elevated)]')
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

interface PopoverContentProps
  extends React.ComponentProps<typeof PopoverPrimitive.Content>, VariantProps<typeof popoverContentVariants> {
  showArrow?: boolean
}

function PopoverContent({
  align = 'center',
  // Keeps the arrow clear of the rounded corners (shared panel radius): Radix
  // clamps the arrow this far from each edge and shifts the popover to
  // compensate, so the arrow never jams into a corner on start/end alignment.
  arrowPadding = 20,
  children,
  className,
  collisionPadding = 8,
  showArrow = true,
  sideOffset = 6,
  variant,
  ...props
}: PopoverContentProps) {
  // Portal into the enclosing dialog when nested in one (keeps focus inside so
  // the dialog doesn't close on dismiss); document.body otherwise.
  const container = usePopoverPortalContainer()

  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        align={align}
        arrowPadding={arrowPadding}
        className={cn(popoverContentVariants({ variant }), className)}
        collisionPadding={collisionPadding}
        data-slot="popover-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
        {/* CSS arrow that truly inherits the surface: a rotated square sharing the
            body's exact bg + backdrop-blur (so it matches even through glass), with
            the border on its two outer edges only. Radix authors the child pointing
            "down" and rotates the wrapper per side, so the V always faces outward.
            The square's inner half tucks under the body, opening the border seam. */}
        {showArrow && (
          <PopoverPrimitive.Arrow asChild height={7} width={16}>
            <span className="relative block h-[7px] w-4 overflow-visible">
              <span
                className={cn(
                  'absolute top-0 left-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-(--popover-surface)',
                  variant === 'accent'
                    ? // Borderless and opaque: nothing to seam, nothing to blur.
                      'rounded-[1px]'
                    : 'border-r border-b border-(--stroke-nous) backdrop-blur-md'
                )}
              />
            </span>
          </PopoverPrimitive.Arrow>
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
