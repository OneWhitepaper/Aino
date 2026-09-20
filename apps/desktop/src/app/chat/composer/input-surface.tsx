import type { ComponentProps } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface RichInputProps extends ComponentProps<'div'> {
  kind: 'rich'
}
interface PlainInputProps extends ComponentProps<'textarea'> {
  kind: 'plain'
}

const INPUT_CLASS =
  'min-h-[1.625rem] min-h-(--composer-input-min-height) max-h-(--composer-input-max-height) cursor-text overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-transparent pb-1 pr-1 pt-1 leading-normal text-foreground outline-none disabled:cursor-not-allowed'

/** One visible input surface; each controller supplies its own owner, draft, ref and event callbacks. */
export function ComposerInputSurface(props: RichInputProps | PlainInputProps) {
  const { t } = useI18n()

  if (props.kind === 'rich') {
    const { kind: _kind, className, ...inputProps } = props

    return (
      <div
        aria-label={t.composer.message}
        autoCapitalize="off"
        autoCorrect="off"
        role="textbox"
        spellCheck={false}
        {...inputProps}
        className={cn(INPUT_CLASS, '**:data-ref-text:cursor-default', className)}
      />
    )
  }

  const { kind: _kind, className, ...inputProps } = props

  return (
    <textarea
      aria-label={t.composer.message}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      {...inputProps}
      className={cn(INPUT_CLASS, 'w-full resize-none', className)}
    />
  )
}
