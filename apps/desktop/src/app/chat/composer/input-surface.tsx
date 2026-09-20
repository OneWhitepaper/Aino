import type { ComponentProps } from 'react'

import { composerFill, composerSurfaceGlass } from '@/components/chat/composer-dock'
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

/** Shared visible shell extracted from ChatBar; controllers keep their own submit and owner state. */
export function ComposerSurface({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'group/composer-surface relative z-4 isolate grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] overflow-hidden rounded-[inherit] border border-[color-mix(in_srgb,var(--dt-composer-ring)_calc(18%*var(--composer-ring-strength)),var(--dt-input))]',
        className
      )}
      data-slot="composer-surface"
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 rounded-[inherit]',
          composerFill,
          composerSurfaceGlass
        )}
      />
      {children}
    </div>
  )
}

export function ComposerContent({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn(
        'relative z-1 flex min-h-0 w-full flex-col gap-(--composer-row-gap) overflow-hidden rounded-[inherit] px-(--composer-surface-pad-x) py-(--composer-surface-pad-y) transition-opacity duration-200 ease-out',
        className
      )}
      data-slot="composer-fade"
    >
      {children}
    </div>
  )
}
