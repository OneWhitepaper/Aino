import * as React from 'react'

import { cn } from '@/lib/utils'

import { type ControlVariantProps, controlVariants } from './control'

function Textarea({
  className,
  size,
  appearance = 'field',
  ...props
}: React.ComponentProps<'textarea'> &
  ControlVariantProps & {
    /** The surrounding composer owns the chrome; the editor keeps native field semantics. */
    appearance?: 'field' | 'composer'
  }) {
  return (
    <textarea
      // Off by default for every consumer — these are code/config/prompt fields,
      // not prose. Callers can re-enable per-instance by passing the prop.
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      className={cn(
        appearance === 'composer'
          ? 'w-full min-w-0 min-h-12 resize-none border-0 bg-transparent p-0 text-[length:var(--aino-text-body)] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50'
          : cn(controlVariants({ size }), 'min-h-16'),
        className
      )}
      data-slot="textarea"
      spellCheck={false}
      {...props}
    />
  )
}

export { Textarea }
