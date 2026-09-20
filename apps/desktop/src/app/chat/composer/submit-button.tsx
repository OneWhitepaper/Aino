import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip, TipKeybindLabel } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { PRIMARY_ICON_BTN } from './control-classes'

interface ComposerSubmitButtonProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  showStop?: boolean
}

/** Shared native form-submit affordance; session queues and managed sends remain controller callbacks. */
export function ComposerSubmitButton({ showStop = false, className, ...props }: ComposerSubmitButtonProps) {
  const { t } = useI18n()
  const label = showStop ? t.composer.stop : t.composer.send

  return (
    <Tip label={<TipKeybindLabel actionId="composer.send" text={label} />}>
      <Button aria-label={label} type="submit" {...props} className={cn(PRIMARY_ICON_BTN, className)}>
        {showStop ? (
          <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
        ) : (
          <Codicon name="arrow-up" size="0.875rem" />
        )}
      </Button>
    </Tip>
  )
}
