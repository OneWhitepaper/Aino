import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import * as React from 'react'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

const BOX =
  'group peer size-4 shrink-0 rounded-[4px] border border-(--ui-stroke-primary) bg-(--ui-bg-editor) shadow-none outline-none transition-shadow data-[state=checked]:border-transparent data-[state=checked]:bg-(--aino-action-bg) data-[state=checked]:text-(--aino-action-fg) data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-(--aino-action-bg) data-[state=indeterminate]:text-(--aino-action-fg)'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        BOX,
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        {/* codicon.css sets `display: inline-block` at higher specificity than a bare
            `hidden`, so both glyphs paint at once without the important modifier. */}
        <Codicon className="hidden! group-data-[state=checked]:block!" name="check" size="0.875rem" />
        <Codicon className="hidden! group-data-[state=indeterminate]:block!" name="dash" size="0.875rem" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

/** The Checkbox look without a control, for rows that are themselves the toggle
 *  (a real Checkbox is a button and can't nest inside one). */
function CheckboxMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(BOX, 'grid place-items-center', className)}
      data-slot="checkbox-mark"
      data-state={checked ? 'checked' : 'unchecked'}
    >
      {checked && <Codicon name="check" size="0.875rem" />}
    </span>
  )
}

export { Checkbox, CheckboxMark }
