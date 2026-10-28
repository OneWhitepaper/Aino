import { profileColorSoft } from '@/lib/profile-color'
import { profileShortLabel } from '@/lib/profile-short-label'
import { cn } from '@/lib/utils'

import { Codicon } from './codicon'

/** A profile's mark, in one place: the default profile is the `home` icon (it
 *  has no color of its own and an initial would read as just another named
 *  profile); every other profile is a soft tint of its color carrying its
 *  initial. Presentational — callers resolve the color from `$profileColors`. */
export function ProfileGlyph({
  className,
  color,
  isDefault,
  name,
  size = 'sm',
  ...props
}: Omit<React.ComponentProps<'span'>, 'color'> & {
  color: null | string
  isDefault: boolean
  name: string
  size?: 'sm' | 'lg'
}) {
  if (isDefault) {
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center',
          size === 'lg' ? 'size-11 rounded-xl bg-(--ui-bg-tertiary)' : 'size-4',
          className
        )}
        {...props}
      >
        <Codicon
          className={size === 'lg' ? 'text-(--ui-text-secondary)' : 'text-(--ui-text-quaternary)'}
          name="home"
          size={size === 'lg' ? '1.25rem' : '0.75rem'}
        />
      </span>
    )
  }

  const initial = profileShortLabel(name)

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center font-semibold uppercase leading-none',
        size === 'lg' ? 'size-11 rounded-xl text-base' : 'size-4 rounded-[3px] text-[0.5rem]',
        className
      )}
      style={{ backgroundColor: profileColorSoft(color ?? 'var(--ui-text-quaternary)', 22), color: color ?? undefined }}
      {...props}
    >
      {initial}
    </span>
  )
}
