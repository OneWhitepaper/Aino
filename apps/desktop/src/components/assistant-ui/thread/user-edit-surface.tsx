import type { ComponentProps } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { StopGlyph, USER_ACTION_ICON_BUTTON_CLASS, USER_ACTION_ICON_SIZE, USER_BUBBLE_BASE_CLASS } from './user-message'

export function UserEditBubble({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        USER_BUBBLE_BASE_CLASS,
        'ui-prompt-input__container relative border-(--ui-stroke-secondary) data-[expanded=true]:min-h-20',
        className
      )}
      {...props}
    />
  )
}

export interface UserEditSubmitButtonProps {
  disabled: boolean
  submitting: boolean
  onSubmit: () => void
}

export function UserEditSubmitButton({ disabled, submitting, onSubmit }: UserEditSubmitButtonProps) {
  const copy = useI18n().t.assistant.thread

  return (
    <Tip label={copy.sendEdited}>
      <button
        aria-label={copy.sendEdited}
        className={cn('absolute right-2 bottom-2 size-5', USER_ACTION_ICON_BUTTON_CLASS)}
        disabled={disabled}
        onClick={onSubmit}
        onPointerDown={event => event.preventDefault()}
        type="button"
      >
        {submitting ? StopGlyph : <Codicon name="arrow-up" size={USER_ACTION_ICON_SIZE} />}
      </button>
    </Tip>
  )
}
